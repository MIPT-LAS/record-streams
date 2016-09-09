/*
 * Copyright (c) 2016 Swift Navigation Inc.
 * Contact: engineering@swiftnav.com
 *
 * This source is subject to the license found in the file 'LICENSE' which must
 * be be distributed together with this source. All other rights reserved.
 *
 * THIS CODE AND INFORMATION IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND,
 * EITHER EXPRESSED OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND/OR FITNESS FOR A PARTICULAR PURPOSE.
 */

import { PassThrough } from 'stream';
import { Parser } from 'binary-parser';
import zipObject from 'lodash/zipObject';

const protocolVersion = 1;
const streamIdOffset = 1;

export const metaParser = new Parser()
  .endianess('little')
  .uint8('streamId')
  .uint32le('metaLength')
  .string('metaString', { length: 'metaLength', encoding: 'ascii' });

export const headParser = new Parser()
  .endianess('little')
  .uint8('protocolVersion')
  .uint32le('headerLen') // size of header, incl. `protocolVersion` and crc
  .uint8('numStreams') // max 255 streams
  .floatle('startTime')
  .array('meta', {
    length: 'numStreams',
    type: metaParser
  })
  .uint16le('crc');

const streamChunkCrcParser = new Parser().endianess('little').uint16le('crc');

const streamChunkDataParser = new Parser()
  .endianess('little')
  .uint8('length') // chunks limited to 255 characters! output multiple chunks if there's overflow
  .array('data', {
    length: 'length',
    type: 'uint8'
  });

export const streamChunkParser = new Parser()
  .endianess('little')
  .uint8('streamId')
  .uint16le('offset') // time since last message was output
  .choice('data', {
    tag: 'streamId',
    choices: {
      0: streamChunkCrcParser // stream id `0` means this is a crc chunk
    },
    defaultChoice: streamChunkDataParser
  });

export const multiplexedStreamParser = new Parser()
  .array('streamChunks', {
    readUntil: 'eof',
    type: streamChunkParser
  });

// TODO: export interface to set up streams recorder
// TODO: export interface to set up streams playback
// TODO: write binary format for stream recorder
// TODO: write binary format for stream playback
// TODO: test record/playback

var crc16tab =  [0x0000,0x1021,0x2042,0x3063,0x4084,0x50a5,0x60c6,0x70e7,
                 0x8108,0x9129,0xa14a,0xb16b,0xc18c,0xd1ad,0xe1ce,0xf1ef,
                 0x1231,0x0210,0x3273,0x2252,0x52b5,0x4294,0x72f7,0x62d6,
                 0x9339,0x8318,0xb37b,0xa35a,0xd3bd,0xc39c,0xf3ff,0xe3de,
                 0x2462,0x3443,0x0420,0x1401,0x64e6,0x74c7,0x44a4,0x5485,
                 0xa56a,0xb54b,0x8528,0x9509,0xe5ee,0xf5cf,0xc5ac,0xd58d,
                 0x3653,0x2672,0x1611,0x0630,0x76d7,0x66f6,0x5695,0x46b4,
                 0xb75b,0xa77a,0x9719,0x8738,0xf7df,0xe7fe,0xd79d,0xc7bc,
                 0x48c4,0x58e5,0x6886,0x78a7,0x0840,0x1861,0x2802,0x3823,
                 0xc9cc,0xd9ed,0xe98e,0xf9af,0x8948,0x9969,0xa90a,0xb92b,
                 0x5af5,0x4ad4,0x7ab7,0x6a96,0x1a71,0x0a50,0x3a33,0x2a12,
                 0xdbfd,0xcbdc,0xfbbf,0xeb9e,0x9b79,0x8b58,0xbb3b,0xab1a,
                 0x6ca6,0x7c87,0x4ce4,0x5cc5,0x2c22,0x3c03,0x0c60,0x1c41,
                 0xedae,0xfd8f,0xcdec,0xddcd,0xad2a,0xbd0b,0x8d68,0x9d49,
                 0x7e97,0x6eb6,0x5ed5,0x4ef4,0x3e13,0x2e32,0x1e51,0x0e70,
                 0xff9f,0xefbe,0xdfdd,0xcffc,0xbf1b,0xaf3a,0x9f59,0x8f78,
                 0x9188,0x81a9,0xb1ca,0xa1eb,0xd10c,0xc12d,0xf14e,0xe16f,
                 0x1080,0x00a1,0x30c2,0x20e3,0x5004,0x4025,0x7046,0x6067,
                 0x83b9,0x9398,0xa3fb,0xb3da,0xc33d,0xd31c,0xe37f,0xf35e,
                 0x02b1,0x1290,0x22f3,0x32d2,0x4235,0x5214,0x6277,0x7256,
                 0xb5ea,0xa5cb,0x95a8,0x8589,0xf56e,0xe54f,0xd52c,0xc50d,
                 0x34e2,0x24c3,0x14a0,0x0481,0x7466,0x6447,0x5424,0x4405,
                 0xa7db,0xb7fa,0x8799,0x97b8,0xe75f,0xf77e,0xc71d,0xd73c,
                 0x26d3,0x36f2,0x0691,0x16b0,0x6657,0x7676,0x4615,0x5634,
                 0xd94c,0xc96d,0xf90e,0xe92f,0x99c8,0x89e9,0xb98a,0xa9ab,
                 0x5844,0x4865,0x7806,0x6827,0x18c0,0x08e1,0x3882,0x28a3,
                 0xcb7d,0xdb5c,0xeb3f,0xfb1e,0x8bf9,0x9bd8,0xabbb,0xbb9a,
                 0x4a75,0x5a54,0x6a37,0x7a16,0x0af1,0x1ad0,0x2ab3,0x3a92,
                 0xfd2e,0xed0f,0xdd6c,0xcd4d,0xbdaa,0xad8b,0x9de8,0x8dc9,
                 0x7c26,0x6c07,0x5c64,0x4c45,0x3ca2,0x2c83,0x1ce0,0x0cc1,
                 0xef1f,0xff3e,0xcf5d,0xdf7c,0xaf9b,0xbfba,0x8fd9,0x9ff8,
                 0x6e17,0x7e36,0x4e55,0x5e74,0x2e93,0x3eb2,0x0ed1,0x1ef0]

/**
 * CRC16 implementation according to CCITT standards.
 * From libsbp.
 */
function crc16 (buf, crc = 0) {
  for (var i = 0; i < buf.length; i++) {
    var ch = buf[i];
    crc = ((crc<<8)&0xFFFF) ^ (crc16tab[((crc>>8)&0xFF) ^ (ch&0xFF)]);
    crc &= 0xFFFF;
  }

  return crc;
}

/**
 * Make a buffer composed of one UInt8.
 */
function mkBuf8 (data) {
  const b = new Buffer(1);
  b.writeUInt8(data, 0);
  return b;
}

/**
 * Make a buffer composed of one UInt16LE.
 */
function mkBuf16le (data) {
  const b = new Buffer(2);
  b.writeUInt16LE(data, 0);
  return b;
}

/**
 * Make a buffer composed of one UInt32LE.
 */
function mkBuf32le (data) {
  const b = new Buffer(4);
  b.writeUInt32LE(data, 0);
  return b;
}

/**
 * Make a buffer composed of one float.
 */
function mkBufFloatLe (data) {
  const b = new Buffer(4);
  b.writeFloatLE(data, 0);
  return b;
}

/**
 * Compose a StreamMeta buffer.
 */
function mkStreamMetaBuf (sm) {
  const stringifiedMeta = JSON.stringify(sm);
  const payload = new Buffer(stringifiedMeta, 'ascii');
  const b = new Buffer(5 + payload.length);
  b.writeUInt8(sm.id, 0);
  b.writeUInt32LE(payload.length, 1);
  b.write(stringifiedMeta, 5);
  return b;
}

function mkStreamChunkBuf (chunk, streamId, offset) {
  // make sure that chunks have maximum size of 255 bytes
  let continuationBuf = new Buffer(0);
  while (chunk.length > 255) {
    const continuationChunk = chunk.slice(chunk.length - 255);
    chunk = chunk.slice(0, chunk.length - 255);
    continuationBuf = Buffer.concat([mkStreamChunkBuf(continuationChunk, streamId, 0), continuationBuf]);
  }

  const start = new Buffer(4);
  start.writeUInt8(streamId, 0);
  start.writeUInt16LE(offset, 1);
  start.writeUInt8(chunk.length, 3);
  return Buffer.concat([start, chunk, continuationBuf]);
}

function mkStreamCrcBuf (offset, crc) {
  const b = new Buffer(5);
  b.writeUInt8(0, 0); // stream ID is 0
  b.writeUInt16LE(offset, 1);
  b.writeUInt16LE(crc, 3);
  return b;
}

/**
 * Record a number of streams to a file. Append streams to a given filename, at
 * the given rate.
 *
 * @param {Array} streams An array of readable streams.
 * @param {String} filename Output filename.
 * @param {Number} appendIntervalMs Interval at which appends to file happen.
 *   If the process crashes in between appends, those data will be lost.
 */
export function recordStreams (streams, filename, appendIntervalMs=1000, maxDataGap=1000*60, crcBufferSize=1500) {
  const outStream = multiplexStreams(streams, maxDataGap, crcBufferSize);
  let buffer = new Buffer(0);
  outStream.on('data', data => { buffer = Buffer.concat([buffer, data]); });
  const interval = setInterval(() => {
    const outBuffer = buffer;
    buffer = new Buffer(0);
    fs.appendFile(filename, outBuffer, err => {
      if (err) {
        throw err;
      }
    });
  }, appendIntervalMs);
  outStream.on('close', () => clearInterval(interval));
  outStream.on('finish', () => clearInterval(interval));
  return outStream;
}

/**
 * Take N streams and return 1 readable stream of composed data.
 *
 * @param {Array} streams An array of readable streams. Data coming over stream must be Buffer.
 * @return Stream A readable stream of composed stream data.
 */
export function multiplexStreams (streams, maxDataGap=1000*60, crcBufferSize=1500) {
  if (streams.length > 254) {
    throw new Error('That is too many streams!');
  }

  const multiplexedStream = new PassThrough();

  const streamsMeta = streams.map((s, id) => {
    return { id: id + streamIdOffset };
  });

  let lastMsgTime = Date.now();

  // Write head
  const headerBufs = [
    mkBuf8(streams.length),
    mkBufFloatLe(lastMsgTime)
  ].concat(streamsMeta.map(sm => mkStreamMetaBuf(sm)));

  const headerLen = headerBufs.reduce((sum, b) => sum + b.length,
                                     1 + // version
                                     4 + // header len
                                     2 // header CRC
                                     );

  multiplexedStream.write(mkBuf8(protocolVersion));
  multiplexedStream.write(mkBuf32le(headerLen));

  const headerBuf = Buffer.concat(headerBufs);
  multiplexedStream.write(headerBuf);
  multiplexedStream.write(mkBuf16le(crc16(headerBuf)));

  let crc = 0;
  let crcProcessedBytes = 0;
  let streamsAlive = 0;

  // send a CRC or offset chunk every so often
  // our 17-bit crc (CRC16) boils all messages down to one of 65,536 values
  // and the chance of error detection is 1-1/(2**17) or five nines, according to
  // http://www.barrgroup.com/Embedded-Systems/How-To/CRC-Math-Theory
  //
  // That's five nines regardless of input size - good enough for this application.
  // Our crc buffer takes up 5 bytes of space. We'd like to ensure that all streams
  // have at least one CRC, but that CRCs take up less than 1% of space.
  //
  // We also want to send a CRC with timestamp offset every 60 seconds, since we have
  // offset overflow at a little over 60 seconds.
  function checkCrc () {
    const now = Date.now();
    const diff = now - lastMsgTime;
    if (diff > maxDataGap || crcProcessedBytes > crcBufferSize || streamsAlive === 0) {
      lastMsgTime = now;
      crcProcessedBytes = 0;

      const buf = mkStreamCrcBuf(diff, crc);
      multiplexedStream.write(buf);

      // crc is also computed on CRC buf!
      crc = crc16(buf, crc);
    }
  }

  streams.forEach((s, id) => {
    streamsAlive++;

    s.on('data', data => {
      if (!Buffer.isBuffer(data)) {
        throw new Error('data coming over stream must be Buffer');
      }
      const now = Date.now();
      const diff = now - lastMsgTime;
      lastMsgTime = now;

      const buf = mkStreamChunkBuf(data, id + streamIdOffset, diff);
      multiplexedStream.write(buf);

      crc = crc16(buf, crc);
      crcProcessedBytes += buf.length;
      checkCrc();
    });

    s.on('finish', () => {
      streamsAlive--;
      checkCrc();
    })
  });

  const interval = setInterval(checkCrc, 1000);
  multiplexedStream.on('end', () => clearInterval(interval));
  multiplexedStream.on('finish', () => clearInterval(interval));

  return multiplexedStream;
}

/**
 * Demultiplex a file.
 */
export function demultiplexFile (filename, useRealOffsets, callback) {
  demultiplexStream(fs.createReadStream(filename), useRealOffsets, callback);
}

/**
 * Demultiplex a full buffer.
 */
export function demultiplexBuffer (buf, useRealOffsets, callback) {
  const s = new PassThrough();
  demultiplexStream(s, useRealOffsets, callback);
  s.write(buf);
}

/**
 * Take a composed stream and multiplex it to N streams.
 *
 * Callback is called once header is parsed. Callback is
 * called with `(err, streams)`.
 */
export function demultiplexStream (stream, useRealOffsets, callback) {
  let buffered = new Buffer(0);
  let parsedHead = false;
  let head = null;
  let streamDict = {};
  let unprocessedChunks = [];

  let chunksCrc = 0;
  let chunkProcessor = null;
  let lastChunkSent = null;

  function processChunks () {
    clearTimeout(chunkProcessor);

    if (unprocessedChunks.length === 0) {
      return;
    }

    const now = Date.now();
    const chunkOffset = unprocessedChunks[0].offset;

    if (lastChunkSent !== null && useRealOffsets && (now - lastChunkSent) < chunkOffset) {
      chunkProcessor = setTimeout(processChunks, chunkOffset - (now - lastChunkSent));
      return;
    }

    const chunk = unprocessedChunks.shift();
    lastChunkSent = now;
    if (chunk.streamId !== 0) {
      streamDict[chunk.streamId].write(new Buffer(chunk.data.data));
    }

    if (unprocessedChunks.length === 0) {
      return;
    }
    const nextChunkOffset = unprocessedChunks[0].offset;

    if (useRealOffsets) {
      chunkProcessor = setTimeout(processChunks, nextChunkOffset);
    } else {
      chunkProcessor = setTimeout(processChunks, 0);
    }
  }

  function parseBuffer () {
    if (buffered.length === 0) {
      return;
    }

    if (!parsedHead) {
      try {
        head = headParser.parse(buffered);
        parsedHead = true;
        buffered = buffered.slice(head.headerLen);
        const streamKeys =  head.meta.map(m => m.streamId);
        const streams = head.meta.map(() => new PassThrough());
        streamDict = zipObject(streamKeys, streams);
        callback(null, streams);
        // TODO: check CRC
      } catch (e) {
      }
    } else {
      const parsedChunks = multiplexedStreamParser.parse(buffered);
      let byteOffset = 0;

      // Calculate which bytes have been processed, and check CRC
      parsedChunks.streamChunks.forEach(c => {
        // add each chunk to the processing queue
        unprocessedChunks.push(c);

        const chunkBufSize = 3 + (c.streamId === 0 ? 2 : c.data.length + 1);

        // is this a CRC? check that our CRC is up-to-date if so
        if (c.streamId === 0 && chunksCrc !== c.data.crc) {
          throw new Error('Incorrect CRC: ' + chunksCrc + ' vs ' + c.data.crc);
        }

        // update CRC
        chunksCrc = crc16(buffered.slice(byteOffset, byteOffset+chunkBufSize), chunksCrc);

        // add this chunk to byte offset
        byteOffset += chunkBufSize;
      });

      // slice parsed chunks out of buffer
      buffered = buffered.slice(byteOffset);
    }

    clearTimeout(chunkProcessor);
    processChunks();

    // keep parsing!
    setImmediate(parseBuffer);
  }

  stream.on('data', data => {
    buffered = Buffer.concat([buffered, data]);

    parseBuffer();
  });
}
