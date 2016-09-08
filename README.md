# record-streams

Multiplexes N streams to a single, compact file. Later, replay the file back to N streams. For applications that rely heavily on processing data from
multiple streams, this allows you to keep full logs of the live data to replay for testing or to duplicate bugs.

Data can be replayed in two modes: in "real offset" mode, where real delays are introduced to mimic the timing of the original messages;
or in a "batched" mode, useful if you want to replay data-processing without mimicking timing.

## Install
Install as a dependency to a project:

```shell
npm install --save record-streams
```

## Caveats
The binary protocol (v1) limits you to a maximum of 254 streams.

Binary output size will be artificially inflated if you have many large
gaps in data that are more than 60 seconds long.

## Use

TBD

## License
MIT license. See `LICENSE` file.
