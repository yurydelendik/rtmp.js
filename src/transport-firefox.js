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

var RtmpTransport = (function RtmpTransportClosure() {
  var DEFAULT_RTMP_PORT = 1935;

  function RtmpTransport(connectionSettings) {
    BaseTransport.call(this);

    if (typeof connectionSettings === 'string') {
      connectionSettings = {host: connectionSettings};
    }

    this.host = connectionSettings.host || 'localhost';
    this.port = connectionSettings.port || DEFAULT_RTMP_PORT;
    this.ssl = connectionSettings.ssl || false;
  }

  RtmpTransport.prototype = Object.create(BaseTransport.prototype, {
    connect: {
      value: function (properties) {
        var TCPSocket = navigator.mozTCPSocket;
        var channel = this.initChannel(properties);

        var writeQueue = [], socketError = false;
        var socket = TCPSocket.open(this.host, this.port,
          { useSSL: this.ssl, binaryType: 'arraybuffer' });


        var sendData = function (data) {
          return socket.send(data.buffer, data.byteOffset, data.byteLength);
        };

        socket.onopen = function (e) {
          channel.ondata = function (data) {
            var buf = new Uint8Array(data);
            writeQueue.push(buf);
            if (writeQueue.length > 1) {
              return;
            }
            RELEASE || console.info('Bytes written: ' + buf.length);
            if (sendData(buf)) {
              writeQueue.shift();
            }
          };
          channel.onclose = function () {
            socket.close();
          };
          channel.start();
        };
        socket.ondrain = function (e) {
          writeQueue.shift();
          RELEASE || console.info('Write completed');
          while (writeQueue.length > 0) {
            RELEASE || console.info('Bytes written: ' + writeQueue[0].length);
            if (!sendData(writeQueue[0])) {
              break;
            }
            writeQueue.shift();
          }
        };
        socket.onclose = function (e) {
          channel.stop(socketError);
        };
        socket.onerror = function (e) {
          socketError = true;
          console.error('socket error: ' + e.data);
        };
        socket.ondata = function (e) {
          RELEASE || console.info('Bytes read: ' + e.data.byteLength);
          channel.push(new Uint8Array(e.data));
        };
      }
    }
  });

  return RtmpTransport;
})();

/*
 * RtmptTransport uses systemXHR to send HTTP requests.
 * See https://developer.mozilla.org/en-US/docs/DOM/XMLHttpRequest#XMLHttpRequest%28%29 and
 * https://github.com/mozilla-b2g/gaia/blob/master/apps/email/README.md#running-in-firefox
 *
 * Spec at http://red5.electroteque.org/dev/doc/html/rtmpt.html
 */
var RtmptTransport = (function RtmpTransportClosure() {
  function RtmptTransport(connectionSettings) {
    BaseTransport.call(this);

    var host = connectionSettings.host || 'localhost';
    var url = (connectionSettings.ssl ? 'https' : 'http') + '://' + host;
    if (connectionSettings.port) {
      url += ':' + connectionSettings.port;
    }
    this.baseUrl = url;

    this.sessionId = null;
    this.requestId = 0;
    this.data = [];
  }

  var emptyPostData = new Uint8Array([0]);

  function post(path, data, onload) {
    data || (data = emptyPostData);

    var xhr = new XMLHttpRequest({mozSystem: true});
    xhr.open('POST', path, true);
    xhr.responseType = 'arraybuffer';
    xhr.setRequestHeader('Content-Type', 'application/x-fcs');
    xhr.onload = function (e) {
      onload(new Uint8Array(xhr.response), xhr.status);
    };
    xhr.onerror = function (e) {
      console.log('error');
      throw 'HTTP error';
    };
    xhr.send(data);
  }

  var COMBINE_DATA = true;

  RtmptTransport.prototype = Object.create(BaseTransport.prototype, {
    connect: {
      value: function (properties) {
        var channel = this.initChannel(properties);
        channel.ondata = function (data) {
          RELEASE || console.info('Bytes written: ' + data.length);
          this.data.push(new Uint8Array(data));
        }.bind(this);
        channel.onclose = function () {
          this.stopped = true;
        }.bind(this);


        post(this.baseUrl + '/fcs/ident2', null, function (data, status) {
          if (status != 404) {
            throw 'Unexpected response: ' + status;
          }

          post(this.baseUrl + '/open/1', null, function (data, status) {
            this.sessionId = String.fromCharCode.apply(null,data).slice(0, -1); // - '\n'
            console.log('session id: ' + this.sessionId);

            this.tick();
            channel.start();
          }.bind(this));
        }.bind(this));
      }
    },
    tick: {
      value: function () {
        var continueSend = function (data, status) {
          if (status != 200) {
            throw 'invalid status';
          }

          var idle = data[0];
          if (data.length > 1) {
            this.channel.push(data.subarray(1));
          }
          setTimeout(this.tick.bind(this), idle * 16);
        }.bind(this);

        if (this.stopped) {
          post(this.baseUrl + '/close/2', null, function () {});
          return;
        }

        if (this.data.length > 0) {
          var data;
          if (COMBINE_DATA) {
            var length = 0;
            this.data.forEach(function (i) { length += i.length; });
            var pos = 0;
            data = new Uint8Array(length);
            this.data.forEach(function (i) { data.set(i, pos); pos += i.length; });
            this.data.length = 0;
          } else {
            data = this.data.shift();
          }
          post(this.baseUrl + '/send/' + this.sessionId + '/' + (this.requestId++),
            data, continueSend);
        } else {
          post(this.baseUrl + '/idle/' + this.sessionId + '/' + (this.requestId++),
            null, continueSend);
        }
      }
    }
  });

  return RtmptTransport;
})();

