/* -*- Mode: js; js-indent-level: 2; indent-tabs-mode: nil; tab-width: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */
/*
 * Copyright 2013 Mozilla Foundation
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

var TRANSPORT_ENCODING = 0;

var BaseTransport = (function BaseTransportClosure() {
  var MAIN_CHUNKED_STREAM_ID = 3;
  var CONNECT_TRANSACTION_ID = 1;
  var DEFAULT_STREAM_ID = 0;

  var COMMAND_MESSAGE_AMF0_ID = 20;
  var COMMAND_MESSAGE_AMF3_ID = 17;

  function BaseTransport() {
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
          console.log('.. Connect sent');
          channel.send(MAIN_CHUNKED_STREAM_ID, {
            streamId: DEFAULT_STREAM_ID,
            typeId: TRANSPORT_ENCODING ? COMMAND_MESSAGE_AMF3_ID : COMMAND_MESSAGE_AMF0_ID,
            data: new Uint8Array(ba)
          });
        };
        channel.onmessage = function (message) {
          console.log('.. Data received: typeId:' + message.typeId + ', streamId:' + message.streamId +
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
            } else {
              var commandObject = ba.readObject();
              var response = ba.readObject();
              if (transport.onresponse) {
                transport.onresponse({commandName: commandName, transactionId: transactionId, commandObject: commandObject, response: response});
              }
            }
            return;
          }
          // TODO misc messages
        };
        channel.onusercontrolmessage = function (e) {
          console.log('.. Event ' + e.type + ' +' + e.data.length + ' bytes');
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
        var channel = this.channel;

        if (true) {
          // Weird stuff (RED5?)
          var ba = new ByteArray();
          ba.objectEncoding = TRANSPORT_ENCODING;
          ba.writeByte(0); // ???
          ba.writeObject('createStream');
          ba.writeObject(transactionId);
          ba.writeObject(commandObject || null);
          channel.send(MAIN_CHUNKED_STREAM_ID, {
            streamId: DEFAULT_STREAM_ID,
            typeId: 17, // ????
            data: new Uint8Array(ba)
          });
          return;
        }
 
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

  return BaseTransport;
})();

var NetStream = (function NetStreamClosure() {
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
      }
    },
    _push: {
      value: function (message) {
console.log('message');
      }
    }
  });

  return NetStream;
})();

