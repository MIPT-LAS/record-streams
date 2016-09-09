'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.multiplexedStreamParser = exports.headParser = undefined;

var _binaryParser = require('binary-parser');

var metaParser = new _binaryParser.Parser().endianess('little').uint8('streamId').uint32le('metaLength').string('metaString', { length: 'metaLength', encoding: 'ascii' }); /*
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

var headParser = exports.headParser = new _binaryParser.Parser().endianess('little').uint8('protocolVersion').uint32le('headerLen') // size of header, incl. `protocolVersion` and crc
.uint8('numStreams') // max 255 streams
.floatle('startTime').array('meta', {
  length: 'numStreams',
  type: metaParser
}).uint16le('crc');

var streamChunkCrcParser = new _binaryParser.Parser().endianess('little').uint16le('crc');

var streamChunkDataParser = new _binaryParser.Parser().endianess('little').uint8('length') // chunks limited to 255 characters! output multiple chunks if there's overflow
.array('data', {
  length: 'length',
  type: 'uint8'
});

var streamChunkParser = new _binaryParser.Parser().endianess('little').uint8('streamId').uint16le('offset') // time since last message was output
.choice('data', {
  tag: 'streamId',
  choices: {
    0: streamChunkCrcParser // stream id `0` means this is a crc chunk
  },
  defaultChoice: streamChunkDataParser
});

var multiplexedStreamParser = exports.multiplexedStreamParser = new _binaryParser.Parser().array('streamChunks', {
  readUntil: 'eof',
  type: streamChunkParser
});