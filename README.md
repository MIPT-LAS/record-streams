# record-streams

`record-streams` makes it easy to record multiple binary streams simultaneously, and to play them back later. It multiplexes up to 254 streams to a single, compact binary stream (or file). Later, you can replay a recorded multiplexed file, which will be de-multiplexed back into N streams.

Because of `Node.js`'s excellent [streaming](https://nodejs.org/api/stream.html) interface, virtually all streams in Node look exactly the same (HTTP streams, file streams, serial port streams, ... etc, all have the same interface). If you have an application where you are relying on live streaming data, it can be useful to have the ability to play back that data in real-time (that is, with simulated delays that mimic the real-world delays of the data). This becomes even more useful if you have multiple streams that you are listening to.

A trivial but real-world example: let's say you have three servers that expose a streaming binary interface. The binary interfaces emit events in a binary protocol at about 15 times per second, or about every 66 milliseconds. You have a dashboard that consumes these streams in real times and shows summary statistics. About every 10 minutes, the dashboard crashes - what to do? Now you can collect a single log of all the streaming input to your application, and replay it as many times as you need to isolate and fix the bug - and you also have a test fixture to run through tests repeatedly! 

See `test/index.js` for examples of how to hook up basic streams and demultiplex them.

## Install
Install as a dependency to a project:

```shell
npm install --save record-streams
```

## Usage

The following functions are all available when you `require('record-streams')`:

### `recordStreams(streams, filename)`

Pass an array of binary streams and a filename. It will start multiplexing the streams'
output to the `filename`.
This function returns a `stream` that you can `.end()` to end multiplexing.

### `multiplexStreams(streams)`

Similar to `recordStreams` but doesn't log out to a file - it only returns the output stream.

### `demultiplexFile(filename, useRealOffsets, callback)`

Demultiplexes the binary data at `filename`.

`useRealOffsets`: a boolean value indicating whether or not the original timing of
the data should be replicated. If so, timeouts will be introduced to the output streams
to mimic the timing of the original streams.

`callback(err, streams)`: called with an error or with a list of output streams. The streams
are in the same order that they were when you recorded the data with `recordStreams`.

### `demultiplexBuffer(buf, useRealOffsets, callback)`

Pass in a [Buffer](https://nodejs.org/api/buffer.html) of multiplexed data. All other parameters
are the same as `demultiplexFilename`.

### `demultiplexStream(stream, useRealOffsets, callback)`

Pass in a [Stream](https://nodejs.org/api/stream.html) of multiplexed data. All other parameters
are the same as `demultiplexFilename`. This is the primitive function used internally by `demultiplexFilename` (which
uses `fs.createReadStream()`) and `demultiplexBuffer` (which creates a stream and writes the entire buffer to
it immediately). It can also be used externally.

## Binary protocol (V1)

TODO

### Caveats
The binary protocol (v1) limits you to a maximum of 254 streams.

Binary output size will be artificially inflated if you have many large
gaps in data that are more than 60 seconds long.

## License
MIT license. See `LICENSE` file.
