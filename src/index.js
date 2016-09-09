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

import fs from 'fs';
import { PassThrough } from 'stream';
import zipObject from 'lodash/zipObject';
import { headParser, multiplexedStreamParser } from './parser';
import crc16 from './crc16';

export { headParser, multiplexedStreamParser };

const protocolVersion = 1;
const streamIdOffset = 1;

// TODO: export interface to set up streams recorder
// TODO: export interface to set up streams playback
// TODO: write binary format for stream recorder
// TODO: write binary format for stream playback
// TODO: test record/playback

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
  let canWrite = true;

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
  function maybeSendCrc () {
    if (!canWrite) {
      return;
    }

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

  function makeListener (id) {
    return data => {
      if (!Buffer.isBuffer(data)) {
        throw new Error('data coming over stream must be Buffer');
      }
      if (!canWrite) {
        return;
      }
      const now = Date.now();
      const diff = now - lastMsgTime;
      lastMsgTime = now;

      const buf = mkStreamChunkBuf(data, id + streamIdOffset, diff);
      multiplexedStream.write(buf);

      crc = crc16(buf, crc);
      crcProcessedBytes += buf.length;
      maybeSendCrc();
    }
  }

  function finishStream (s, id) {
    streamsAlive--;
    maybeSendCrc();
    s.removeAllListeners('data');
    s.removeAllListeners('finish');
  }

  const streamListeners = streams.map((s, id) => makeListener(id));

  streams.forEach((s, id) => {
    streamsAlive++;
    s.on('data', streamListeners[id]);
    s.on('finish', () => finishStream(s, id))
  });

  const interval = setInterval(maybeSendCrc, 1000);

  function stop () {
    canWrite = false;
    clearInterval(interval);
    streams.forEach((s, id) => finishStream(s, id));
  }

  multiplexedStream.on('end', () => stop());
  multiplexedStream.on('finish', () => stop());
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
