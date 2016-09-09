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

import { Parser } from 'binary-parser';

const metaParser = new Parser()
  .endianess('little')
  .uint8('streamId')
  .uint32le('metaLength')
  .string('metaString', { length: 'metaLength', encoding: 'ascii' });

export const headParser = new Parser()
  .endianess('little')
  .uint8('protocolVersion') // should be 1
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
