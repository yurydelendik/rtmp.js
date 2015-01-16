/*
 * Copyright 2015 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

///<reference path='references.ts' />
module RtmpJs {
  import RELEASE = Shumway.RELEASE;
  import ByteArray = Shumway.ByteArray;

  var TRANSPORT_ENCODING = 0;

  var MAIN_CHUNKED_STREAM_ID = 3;
  var CONNECT_TRANSACTION_ID = 1;
  var DEFAULT_STREAM_ID = 0;

  var COMMAND_MESSAGE_AMF0_ID = 20;
  var COMMAND_MESSAGE_AMF3_ID = 17;

  var SET_BUFFER_CONTROL_MESSAGE_ID = 3;
  var PING_REQUEST_CONTROL_MESSAGE_ID = 6;
  var PING_RESPONSE_CONTROL_MESSAGE_ID = 7;

  export function BaseTransport() {
    this.streams = [];
  }

  BaseTransport.prototype = Object.create(Object.prototype, {
    initChannel: {
      value: function (properties, args) {
        var channel = new ChunkedChannel();
        var transport = this;
        channel.oncreated = function () {
          var ba = new ByteArray();
          ba.objectEncoding = TRANSPORT_ENCODING;
          ba.writeObject('connect');
          ba.writeObject(CONNECT_TRANSACTION_ID);
          ba.writeObject(properties);
          ba.writeObject(args || null);
          RELEASE || console.log('.. Connect sent');
          channel.send(MAIN_CHUNKED_STREAM_ID, {
            streamId: DEFAULT_STREAM_ID,
            typeId: TRANSPORT_ENCODING ? COMMAND_MESSAGE_AMF3_ID : COMMAND_MESSAGE_AMF0_ID,
            data: new Uint8Array(ba)
          });
        };
        channel.onmessage = function (message) {
          RELEASE || console.log('.. Data received: typeId:' + message.typeId +
            ', streamId:' + message.streamId +
            ', cs: ' + message.chunkedStreamId);

          if (message.streamId !== 0) {
            transport.streams[message.streamId]._push(message);
            return;
          }

          if (message.typeId === COMMAND_MESSAGE_AMF0_ID ||
            message.typeId === COMMAND_MESSAGE_AMF3_ID) {
            var ba = new ByteArray(message.data);
            ba.objectEncoding = message.typeId === COMMAND_MESSAGE_AMF0_ID ? 0 : 3;
            var commandName = ba.readObject();
            if (commandName === undefined) { // ??? not sure what specification says and what real stuff are
              ba.objectEncoding = 0;
              commandName = ba.readObject();
            }
            var transactionId = ba.readObject();
            if (commandName === '_result' || commandName === '_error') {
              var isError = commandName === '_error';
              if (transactionId === CONNECT_TRANSACTION_ID) {
                var properties = ba.readObject();
                var information = ba.readObject();
                if (transport.onconnected) {
                  transport.onconnected({properties: properties, information: information, isError: isError});
                }
              } else {
                var commandObject = ba.readObject();
                var streamId = ba.readObject();
                if (transport.onstreamcreated) {
                  var stream = new NetStream(transport, streamId);
                  transport.onstreamcreated({transactionId: transactionId, commandObject: commandObject, streamId: streamId, stream: stream, isError: isError});
                }
              }
            } else if (commandName === 'onBWCheck' || commandName === 'onBWDone') {
              // TODO skipping those for now
              transport.sendCommandOrResponse('_error', transactionId, null,
                { code: 'NetConnection.Call.Failed', level: 'error' });
            } else {
              var commandObject = ba.readObject();
              var response = ba.position < ba.length ? ba.readObject() : undefined;
              if (transport.onresponse) {
                transport.onresponse({commandName: commandName, transactionId: transactionId, commandObject: commandObject, response: response});
              }
            }
            return;
          }
          // TODO misc messages
        };
        channel.onusercontrolmessage = function (e) {
          RELEASE || console.log('.. Event ' + e.type + ' +' + e.data.length + ' bytes');
          if (e.type === PING_REQUEST_CONTROL_MESSAGE_ID) {
            channel.sendUserControlMessage(PING_RESPONSE_CONTROL_MESSAGE_ID, e.data);
          }
          if (transport.onevent) {
            transport.onevent({type: e.type, data: e.data});
          }
        };

        return (this.channel = channel);
      }
    },
    call: {
      value: function (procedureName, transactionId, commandObject, args) {
        var channel = this.channel;

        var ba = new ByteArray();
        ba.objectEncoding = TRANSPORT_ENCODING;
        ba.writeObject(procedureName);
        ba.writeObject(transactionId);
        ba.writeObject(commandObject);
        ba.writeObject(args);
        channel.send(MAIN_CHUNKED_STREAM_ID, {
          streamId: DEFAULT_STREAM_ID,
          typeId: TRANSPORT_ENCODING ? COMMAND_MESSAGE_AMF3_ID : COMMAND_MESSAGE_AMF0_ID,
          data: new Uint8Array(ba)
        });
      }
    },
    createStream: {
      value: function (transactionId, commandObject) {
        this.sendCommandOrResponse('createStream', transactionId, commandObject);
      }
    },
    sendCommandOrResponse: {
      value: function (commandName, transactionId, commandObject, response) {
        var channel = this.channel;

        var ba = new ByteArray();
        ba.writeByte(0); // ???
        ba.objectEncoding = 0; // TRANSPORT_ENCODING;
        ba.writeObject(commandName);
        ba.writeObject(transactionId);
        ba.writeObject(commandObject || null);
        if (arguments.length > 3)
          ba.writeObject(response);
        channel.send(MAIN_CHUNKED_STREAM_ID, {
          streamId: DEFAULT_STREAM_ID,
          typeId: COMMAND_MESSAGE_AMF3_ID,
          data: new Uint8Array(ba)
        });

        /*     // really weird that this does not work
         var ba = new ByteArray();
         ba.objectEncoding = TRANSPORT_ENCODING;
         ba.writeObject('createStream');
         ba.writeObject(transactionId);
         ba.writeObject(commandObject || null);
         channel.send(MAIN_CHUNKED_STREAM_ID, {
         streamId: DEFAULT_STREAM_ID,
         typeId: TRANSPORT_ENCODING ? COMMAND_MESSAGE_AMF3_ID : COMMAND_MESSAGE_AMF0_ID,
         data: new Uint8Array(ba)
         });
         */
      }
    },
    _setBuffer: {
      value: function (streamId, ms) {
        this.channel.sendUserControlMessage(SET_BUFFER_CONTROL_MESSAGE_ID, new Uint8Array([
            (streamId >> 24) & 0xFF,
            (streamId >> 16) & 0xFF,
            (streamId >> 8) & 0xFF,
            streamId & 0xFF,
            (ms >> 24) & 0xFF,
            (ms >> 16) & 0xFF,
            (ms >> 8) & 0xFF,
            ms & 0xFF
        ]));
      }
    },
    _sendCommand: {
      value: function (streamId, data) {
        this.channel.send(8, {
          streamId: streamId,
          typeId: TRANSPORT_ENCODING ? COMMAND_MESSAGE_AMF3_ID : COMMAND_MESSAGE_AMF0_ID,
          data: data
        });
      }
    }
  });

  var DEFAULT_BUFFER_LENGTH = 100; // ms

  function NetStream(transport, streamId) {
    this.transport = transport;
    this.streamId = streamId;
    transport.streams[streamId] = this;
  }

  NetStream.prototype = Object.create(Object.prototype, {
    play: {
      value: function (name, start, duration, reset) {
        var ba = new ByteArray();
        ba.objectEncoding = TRANSPORT_ENCODING;
        ba.writeObject('play');
        ba.writeObject(0);
        ba.writeObject(null);
        ba.writeObject(name);
        if (arguments.length > 1)
          ba.writeObject(start);
        if (arguments.length > 2)
          ba.writeObject(duration);
        if (arguments.length > 3)
          ba.writeObject(reset);
        this.transport._sendCommand(this.streamId, new Uint8Array(ba));
        // set the buffer, otherwise it will stop in ~15 sec
        this.transport._setBuffer(this.streamId, DEFAULT_BUFFER_LENGTH);
      }
    },
    _push: {
      value: function (message) {
        switch (message.typeId) {
          case 8:
          case 9:
            if (this.ondata) {
              this.ondata(message);
            }
            break;
          case 18:
          case 20:
            var args = [];
            var ba = new ByteArray(message.data);
            ba.objectEncoding = 0;
            while (ba.position < ba.length) {
              args.push(ba.readObject());
            }
            if (message.typeId === 18 && this.onscriptdata) {
              this.onscriptdata.apply(this, args);
            }
            if (message.typeId === 20 && this.oncallback) {
              this.oncallback.apply(this, args);
            }
            break;
        }
      }
    }
  });
}