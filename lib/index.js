'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.multiplexedStreamParser = exports.headParser = undefined;
exports.recordStreams = recordStreams;
exports.multiplexStreams = multiplexStreams;
exports.demultiplexFile = demultiplexFile;
exports.demultiplexBuffer = demultiplexBuffer;
exports.demultiplexStream = demultiplexStream;

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var _stream = require('stream');

var _zipObject = require('lodash/zipObject');

var _zipObject2 = _interopRequireDefault(_zipObject);

var _parser = require('./parser');

var _crc = require('./crc16');

var _crc2 = _interopRequireDefault(_crc);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

exports.headParser = _parser.headParser;
exports.multiplexedStreamParser = _parser.multiplexedStreamParser; /*
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

var protocolVersion = 1;
var streamIdOffset = 1;

// TODO: export interface to set up streams recorder
// TODO: export interface to set up streams playback
// TODO: write binary format for stream recorder
// TODO: write binary format for stream playback
// TODO: test record/playback

/**
 * Make a buffer composed of one UInt8.
 */
function mkBuf8(data) {
  var b = new Buffer(1);
  b.writeUInt8(data, 0);
  return b;
}

/**
 * Make a buffer composed of one UInt16LE.
 */
function mkBuf16le(data) {
  var b = new Buffer(2);
  b.writeUInt16LE(data, 0);
  return b;
}

/**
 * Make a buffer composed of one UInt32LE.
 */
function mkBuf32le(data) {
  var b = new Buffer(4);
  b.writeUInt32LE(data, 0);
  return b;
}

/**
 * Make a buffer composed of one float.
 */
function mkBufFloatLe(data) {
  var b = new Buffer(4);
  b.writeFloatLE(data, 0);
  return b;
}

/**
 * Compose a StreamMeta buffer.
 */
function mkStreamMetaBuf(sm) {
  var stringifiedMeta = JSON.stringify(sm);
  var payload = new Buffer(stringifiedMeta, 'ascii');
  var b = new Buffer(5 + payload.length);
  b.writeUInt8(sm.id, 0);
  b.writeUInt32LE(payload.length, 1);
  b.write(stringifiedMeta, 5);
  return b;
}

function mkStreamChunkBuf(chunk, streamId, offset) {
  // make sure that chunks have maximum size of 255 bytes
  var continuationBuf = new Buffer(0);
  while (chunk.length > 255) {
    var continuationChunk = chunk.slice(chunk.length - 255);
    chunk = chunk.slice(0, chunk.length - 255);
    continuationBuf = Buffer.concat([mkStreamChunkBuf(continuationChunk, streamId, 0), continuationBuf]);
  }

  var start = new Buffer(4);
  start.writeUInt8(streamId, 0);
  start.writeUInt16LE(offset, 1);
  start.writeUInt8(chunk.length, 3);
  return Buffer.concat([start, chunk, continuationBuf]);
}

function mkStreamCrcBuf(offset, crc) {
  var b = new Buffer(5);
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
function recordStreams(streams, filename) {
  var appendIntervalMs = arguments.length <= 2 || arguments[2] === undefined ? 1000 : arguments[2];
  var maxDataGap = arguments.length <= 3 || arguments[3] === undefined ? 1000 * 60 : arguments[3];
  var crcBufferSize = arguments.length <= 4 || arguments[4] === undefined ? 1500 : arguments[4];

  var outStream = multiplexStreams(streams, maxDataGap, crcBufferSize);
  var buffer = new Buffer(0);
  outStream.on('data', function (data) {
    buffer = Buffer.concat([buffer, data]);
  });
  var interval = setInterval(function () {
    var outBuffer = buffer;
    buffer = new Buffer(0);
    _fs2.default.appendFile(filename, outBuffer, function (err) {
      if (err) {
        throw err;
      }
    });
  }, appendIntervalMs);
  outStream.on('close', function () {
    return clearInterval(interval);
  });
  outStream.on('finish', function () {
    return clearInterval(interval);
  });
  return outStream;
}

/**
 * Take N streams and return 1 readable stream of composed data.
 *
 * @param {Array} streams An array of readable streams. Data coming over stream must be Buffer.
 * @return Stream A readable stream of composed stream data.
 */
function multiplexStreams(streams) {
  var maxDataGap = arguments.length <= 1 || arguments[1] === undefined ? 1000 * 60 : arguments[1];
  var crcBufferSize = arguments.length <= 2 || arguments[2] === undefined ? 1500 : arguments[2];

  if (streams.length > 254) {
    throw new Error('That is too many streams!');
  }

  var multiplexedStream = new _stream.PassThrough();

  var streamsMeta = streams.map(function (s, id) {
    return { id: id + streamIdOffset };
  });

  var lastMsgTime = Date.now();

  // Write head
  var headerBufs = [mkBuf8(streams.length), mkBufFloatLe(lastMsgTime)].concat(streamsMeta.map(function (sm) {
    return mkStreamMetaBuf(sm);
  }));

  var headerLen = headerBufs.reduce(function (sum, b) {
    return sum + b.length;
  }, 1 + // version
  4 + // header len
  2 // header CRC
  );

  multiplexedStream.write(mkBuf8(protocolVersion));
  multiplexedStream.write(mkBuf32le(headerLen));

  var headerBuf = Buffer.concat(headerBufs);
  multiplexedStream.write(headerBuf);
  multiplexedStream.write(mkBuf16le((0, _crc2.default)(headerBuf)));

  var crc = 0;
  var crcProcessedBytes = 0;
  var streamsAlive = 0;
  var canWrite = true;

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
  function maybeSendCrc() {
    if (!canWrite) {
      return;
    }

    var now = Date.now();
    var diff = now - lastMsgTime;
    if (diff > maxDataGap || crcProcessedBytes > crcBufferSize || streamsAlive === 0) {
      lastMsgTime = now;
      crcProcessedBytes = 0;

      var buf = mkStreamCrcBuf(diff, crc);
      multiplexedStream.write(buf);

      // crc is also computed on CRC buf!
      crc = (0, _crc2.default)(buf, crc);
    }
  }

  function makeListener(id) {
    return function (data) {
      if (!Buffer.isBuffer(data)) {
        throw new Error('data coming over stream must be Buffer');
      }
      if (!canWrite) {
        return;
      }
      var now = Date.now();
      var diff = now - lastMsgTime;
      lastMsgTime = now;

      var buf = mkStreamChunkBuf(data, id + streamIdOffset, diff);
      multiplexedStream.write(buf);

      crc = (0, _crc2.default)(buf, crc);
      crcProcessedBytes += buf.length;
      maybeSendCrc();
    };
  }

  function finishStream(s, id) {
    streamsAlive--;
    maybeSendCrc();
    s.removeAllListeners('data');
    s.removeAllListeners('finish');
  }

  var streamListeners = streams.map(function (s, id) {
    return makeListener(id);
  });

  streams.forEach(function (s, id) {
    streamsAlive++;
    s.on('data', streamListeners[id]);
    s.on('finish', function () {
      return finishStream(s, id);
    });
  });

  var interval = setInterval(maybeSendCrc, 1000);

  function stop() {
    canWrite = false;
    clearInterval(interval);
    streams.forEach(function (s, id) {
      return finishStream(s, id);
    });
  }

  multiplexedStream.on('end', function () {
    return stop();
  });
  multiplexedStream.on('finish', function () {
    return stop();
  });
  return multiplexedStream;
}

/**
 * Demultiplex a file.
 */
function demultiplexFile(filename, useRealOffsets, callback) {
  demultiplexStream(_fs2.default.createReadStream(filename), useRealOffsets, callback);
}

/**
 * Demultiplex a full buffer.
 */
function demultiplexBuffer(buf, useRealOffsets, callback) {
  var s = new _stream.PassThrough();
  demultiplexStream(s, useRealOffsets, callback);
  s.write(buf);
}

/**
 * Take a composed stream and multiplex it to N streams.
 *
 * Callback is called once header is parsed. Callback is
 * called with `(err, streams)`.
 */
function demultiplexStream(stream, useRealOffsets, callback) {
  var buffered = new Buffer(0);
  var parsedHead = false;
  var head = null;
  var streamDict = {};
  var unprocessedChunks = [];

  var chunksCrc = 0;
  var chunkProcessor = null;
  var lastChunkSent = null;

  function processChunks() {
    clearTimeout(chunkProcessor);

    if (unprocessedChunks.length === 0) {
      return;
    }

    var now = Date.now();
    var chunkOffset = unprocessedChunks[0].offset;

    if (lastChunkSent !== null && useRealOffsets && now - lastChunkSent < chunkOffset) {
      chunkProcessor = setTimeout(processChunks, chunkOffset - (now - lastChunkSent));
      return;
    }

    var chunk = unprocessedChunks.shift();
    lastChunkSent = now;
    if (chunk.streamId !== 0) {
      streamDict[chunk.streamId].write(new Buffer(chunk.data.data));
    }

    if (unprocessedChunks.length === 0) {
      return;
    }
    var nextChunkOffset = unprocessedChunks[0].offset;

    if (useRealOffsets) {
      chunkProcessor = setTimeout(processChunks, nextChunkOffset);
    } else {
      chunkProcessor = setTimeout(processChunks, 0);
    }
  }

  function parseBuffer() {
    if (buffered.length === 0) {
      return;
    }

    if (!parsedHead) {
      try {
        head = _parser.headParser.parse(buffered);
        parsedHead = true;
        buffered = buffered.slice(head.headerLen);
        var streamKeys = head.meta.map(function (m) {
          return m.streamId;
        });
        var streams = head.meta.map(function () {
          return new _stream.PassThrough();
        });
        streamDict = (0, _zipObject2.default)(streamKeys, streams);
        callback(null, streams);
        // TODO: check CRC
      } catch (e) {}
    } else {
      (function () {
        var parsedChunks = _parser.multiplexedStreamParser.parse(buffered);
        var byteOffset = 0;

        // Calculate which bytes have been processed, and check CRC
        parsedChunks.streamChunks.forEach(function (c) {
          // add each chunk to the processing queue
          unprocessedChunks.push(c);

          var chunkBufSize = 3 + (c.streamId === 0 ? 2 : c.data.length + 1);

          // is this a CRC? check that our CRC is up-to-date if so
          if (c.streamId === 0 && chunksCrc !== c.data.crc) {
            throw new Error('Incorrect CRC: ' + chunksCrc + ' vs ' + c.data.crc);
          }

          // update CRC
          chunksCrc = (0, _crc2.default)(buffered.slice(byteOffset, byteOffset + chunkBufSize), chunksCrc);

          // add this chunk to byte offset
          byteOffset += chunkBufSize;
        });

        // slice parsed chunks out of buffer
        buffered = buffered.slice(byteOffset);
      })();
    }

    clearTimeout(chunkProcessor);
    processChunks();

    // keep parsing!
    setImmediate(parseBuffer);
  }

  stream.on('data', function (data) {
    buffered = Buffer.concat([buffered, data]);

    parseBuffer();
  });
}