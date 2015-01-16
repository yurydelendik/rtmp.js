var r = require('./build/ts/rtmp-node.js').RtmpJs.Node;

var props = {
          app: 'oflaDemo',
          flashver: 'MAC 11,6,602,180',
          swfUrl: 'http://localhost:5080/demos/Something.swf',
          tcUrl: 'rtmpt://localhost:8088/oflaDemo',
          fpad: false,
          audioCodecs: 0x0FFF,
          videoCodecs: 0x00FF,
          videoFunction: 1,
          pageUrl: 'http://localhost:5080/demos/Something.html',
          objectEncoding: 0
        };


//var rtmp = new r.RtmpTransport({host:'localhost', port:1935});
var rtmp = new r.RtmptTransport({host:'localhost', port:5080});

rtmp.onresponse = function (e) {
  console.log('#response');
};
rtmp.onevent = function (e) {
  console.log('#event');
};
rtmp.onconnected = function (e) {
  console.log('#connected');

  rtmp.createStream(2, null);
};
rtmp.onstreamcreated = function (e) {
  console.log('#streamcreated: ' + e.streamId);

  var ns = e.stream;
  ns.play('hobbit_vp6.flv');
};
rtmp.connect(props);

