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

require('./util.js');
require('./amf.js');
require('./rtmp.js');
require('./transport.js');


var RtmpTransport = (function RtmpTransportClosure() {
  var net = require('net');
  var DEFAULT_RTMP_PORT = 1935;

  function RtmpTransport(connectionSettings) {
    BaseTransport.call(this);

    if (typeof connectionSettings === 'string') {
      connectionSettings = {host: connectionSettings};
    }

    this.host = connectionSettings.host || 'localhost';
    this.port = connectionSettings.port || DEFAULT_RTMP_PORT;
  }

  RtmpTransport.prototype = Object.create(BaseTransport.prototype, {
    connect: {
      value: function (properties) {
        var channel = this.initChannel(properties);

        var writeQueue = [];
        var client = net.createConnection({port: this.port, host: this.host},
            function() { //'connect' listener
          channel.ondata = function (data) {
            var buf = new Buffer(data);
            writeQueue.push(buf);
            if (writeQueue.length > 1) {
              return;
            }
            RELEASE || console.info('Bytes written: ' + buf.length);
            client.write(buf);
          };
          channel.onclose = function () {
            client.destroy();
          };
          channel.start();
        });
        client.setEncoding('hex');
        client.setNoDelay(true);
        client.on('drain', function(data) {
          writeQueue.shift();
          RELEASE || console.info('Write completed');
          if (writeQueue.length > 0) {
            RELEASE || console.info('Bytes written: ' + writeQueue[0].length);
            client.write(writeQueue[0]);
          }
        });
        client.on('data', function(data) {
          RELEASE || console.info('Bytes read: ' + (data.length >> 1));
          var buf = new Buffer(data, 'hex');
          channel.push(buf);
        });
        client.on('close', function(obj) {
          channel.stop(obj.has_error);
        });
      }
    }
  });

  return RtmpTransport;
})();

var RtmptTransport = (function RtmpTransportClosure() {
  var http = require('http');

  function RtmptTransport(connectionSettings) {
    BaseTransport.call(this);

    this.host = connectionSettings.host || 'localhost';
    this.protocol = connectionSettings.ssl ? 'https:' : 'http:';
    this.port = connectionSettings.port || (connectionSettings.ssl ? 443 : 80);

    this.sessionId = null;
    this.requestId = 0;
    this.data = [];
  }

  var emptyPostData = new Uint8Array([0]);

  var COMBINE_DATA = false;

  RtmptTransport.prototype = Object.create(BaseTransport.prototype, {
    _post: {
      value: function post(path, data, onload) {
        data || (data = emptyPostData);

        var options = {
          hostname: this.host,
          port: this.port,
          protocol: this.protocol,
          path: path,
          method: 'POST',
          headers: {
            'content-length': data.length,
            'content-type': 'application/x-fcs',
            'connection': 'keep-alive'
          }
        };

        var req = http.request(options, function (res) {
          res.setEncoding('hex');
          var buffer = '';
          res.on('data', function (chunk) {
            buffer += chunk;
          });
          res.on('end', function () {
            var decoded = new Buffer(buffer, 'hex');
            onload(decoded, res.statusCode);
          });
        });
        req.end(new Buffer(data));
      }
    },
    connect: {
      value: function (properties) {
        var channel = this.initChannel(properties);
        channel.ondata = function (data) {
          RELEASE || console.info('Bytes written: ' + data.length);
          this.data.push(Array.prototype.slice.call(data, 0));
        }.bind(this);
        channel.onclose = function () {
          this.stopped = true;
        }.bind(this);


        this._post('/fcs/ident2', null, function (data, status) {
          if (status != 404) {
            throw 'Unexpected response: ' + status;
          }

          this._post('/open/1', null, function (data, status) {
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
            throw 'invalid status: ' + status;
          }

          var idle = data[0];
          if (data.length > 1) {
            var buf = new Uint8Array(data.length - 1);
            for (var i = 1; i < data.length; i++) {
              buf[i - 1] = data[i];
            }
            this.channel.push(buf);
          }
          setTimeout(this.tick.bind(this), idle * 16);
        }.bind(this);

        if (this.stopped) {
          this._post('/close/2', null, function () {});
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
          this._post('/send/' + this.sessionId + '/' + (this.requestId++),
            data, continueSend);
        } else {
          this._post('/idle/' + this.sessionId + '/' + (this.requestId++),
            null, continueSend);
        }
      }
    }
  });

  return RtmptTransport;
})();

exports.RtmpTransport = RtmpTransport;
exports.RtmptTransport = RtmptTransport;
