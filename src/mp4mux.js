var MP4Mux = (function MP4MuxClosure() {
  function hex(s) {
    var len = s.length >> 1;
    var arr = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
      arr[i] = parseInt(s.substr(i * 2, 2), 16);
    }
    return arr;
  }

  function flatten(arr) {
    if (arr instanceof Uint8Array)
      return arr;
    if (typeof arr === 'number')
      return new Uint8Array([arr]);
    if (typeof arr === 'string') {
      var result = new Uint8Array(arr.length);
      for (var i = 0; i < result.length; i++)
        result[i] = arr.charCodeAt(i) & 255; 
      return result;
    }
    arr = arr.map(flatten);
    var len = 0; arr.forEach(function (i) { len += i.length; });
    var result = new Uint8Array(len);
    var pos = 0; arr.forEach(function (i) { result.set(i, pos); pos += i.length; });
    return result;
  }

  function encodeInt32(n) {
    return new Uint8Array([(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
  }

  function encodeUint16(n) {
    return new Uint8Array([(n >> 8) & 255, n & 255]);
  }

  function encodeFloat(n) {
    return encodeInt32(n * 65536);
  }

  function encodeFloat16(n) {
    return encodeUint16(n * 256);
  }

  function encodeLang(s) {
    return encodeUint16(((s.charCodeAt(0) & 0x1F) << 10) | ((s.charCodeAt(1) & 0x1F) << 5) | (s.charCodeAt(2) & 0x1F));
  }

  function tag(name, data) {
    if (name.length != 4) throw 'bad tag name';
    data = flatten(data);
    var len = 8 + data.length;
    if (len > 0x7FFFFFFF) throw 'bad tag length';
    return flatten([encodeInt32(len), name, data]);
  }

  var SOUNDRATES = [5500, 11025, 22050, 44100];
  var SOUNDFORMATS = ['PCM', 'ADPCM', 'MP3', 'PCM le', 'Nellymouser16', 'Nellymouser8', 'Nellymouser', 'G.711 A-law', 'G.711 mu-law', null, 'AAC', 'Speex', 'MP3 8khz'];
  var MP3_SOUND_CODEC_ID = 2;
  var AAC_SOUND_CODEC_ID = 10;
  function parseAudiodata(data) {
    var i = 0;
    var result = {
      codecDescription: SOUNDFORMATS[data[i] >> 4],
      codecId: data[i] >> 4,
      rate: SOUNDRATES[(data[i] >> 2) & 3],
      size: data[i] & 2 ? 16 : 8,
      channels: data[i] & 1 ? 2 : 1
    };
    i++;
    switch (result.codecId) {
    case AAC_SOUND_CODEC_ID:
      var type = data[i++];
      result.packetType = type;
      result.samples = 1024;
      break;
    case MP3_SOUND_CODEC_ID:
      var version =(data[i + 1] >> 3) & 3; // 3 - MPEG 1
      var layer = (data[i + 1] >> 1) & 3; // 3 - Layer I, 2 - II, 1 - III
      result.samples = layer === 1 ? (version === 3 ? 1152 : 576) :
        (layer === 3 ? 384 : 1152);
      break;
    }
    result.data = data.subarray(i);
    return result;
  }

  var VIDEOCODECS = [null, 'JPEG', 'Sorenson', 'Screen', 'VP6', 'VP6 alpha', 'Screen2', 'AVC'];
  var VP6_VIDEO_CODEC_ID = 4;
  var AVC_VIDEO_CODEC_ID = 7;
  function parseVideodata(data) {
    var i = 0;
    var frameType = data[i] >> 4;
    var codecId = data[i] & 15;
    i++;
    var result = {
       frameType: frameType,
       codecId: codecId,
       codecDescription: VIDEOCODECS[codecId]
    };
    switch (codecId) {
    case AVC_VIDEO_CODEC_ID:
      var type = data[i++];
      result.packetType = type;
      result.compositionTime = ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8)) >> 8;
      i += 3;
      break;
    case VP6_VIDEO_CODEC_ID:
      result.horizontalOffset = (data[i] >> 4) & 15;
      result.verticalOffset = data[i] & 15;
      i++;
      break;
    }
    result.data = data.subarray(i);
    return result;
  }

  function MP4Mux(metadata) {
    this.metadata = metadata;
    this.tracks = [];
    this.audioTrackId = -1;
    this.videoTrackId = -1;
    this.waitForAdditionalData = false;
    if (metadata.trackinfo) {
      for (var i = 0; i < metadata.trackinfo.length; i++) {
        var info = metadata.trackinfo[i];
        var track = {
          language: info.language,
          type: info.sampledescription[0].sampletype,
          timescale: info.timescale,
          cache: []
        };
        if (info.sampledescription[0].sampletype === metadata.audiocodecid) {
          this.audioTrackId = i;
          track.samplerate = metadata.audiosamplerate;
          track.channels = metadata.audiochannels;
        } else if (info.sampledescription[0].sampletype === metadata.videocodecid) {
          this.videoTrackId = i;
          track.framerate = metadata.videoframerate;
          track.width = metadata.width;
          track.height =  metadata.height;
        }
        this.tracks.push(track);
      }
      this.waitForAdditionalData = true;
    } else {
      if (metadata.audiocodecid) {
        if (metadata.audiocodecid !== 2)
          throw 'unsupported audio codec: ' + metadata.audiocodec;
        this.audioTrackId = this.tracks.length;
        this.tracks.push({
          language: "unk",
          type: "mp3",
          timescale: metadata.audiosamplerate,
          samplerate: metadata.audiosamplerate,
          channels: metadata.audiochannels,
          cache: []
        });
      }
      if (metadata.videocodecid) {
        if (metadata.videocodecid !== 4)
          throw 'unsupported video codec: ' + metadata.videocodecid;
        this.videoTrackId = this.tracks.length;
        this.tracks.push({
          language: "unk",
          type: "vp6f",
          timescale: 10000,
          framerate: metadata.framerate,
          width: metadata.width,
          height: metadata.height,
          cache: []
        });
      }
    }
    this.filePos = 0;
    this.cachedPackets = 0;
    this.state = 0;
    this.chunkIndex = 0;
  }

  var AUDIO_PACKET = 8;
  var VIDEO_PACKET = 9;
  var MAX_PACKETS_IN_CHUNK = 5;

  MP4Mux.prototype = {
    pushPacket: function (type, data) {
      if (this.state === 0 && !this.waitForAdditionalData) {
        this.generateHeader();
      }

      switch (type) {
      case AUDIO_PACKET: // audio
        var audioPacket = parseAudiodata(data);
        switch (audioPacket.codecId) {
        default:
          throw 'unsupported audio codec: ' + audioPacket.codecDescription;
        case MP3_SOUND_CODEC_ID:
          break; // supported codec
        case AAC_SOUND_CODEC_ID:
          if (audioPacket.packetType !== 0 && this.state === 0)
            this.generateHeader();
          break;
        }
        this.tracks[this.audioTrackId].cache.push(audioPacket);
        this.cachedPackets++;
        break;
      case VIDEO_PACKET:
        var videoPacket = parseVideodata(data);
        switch (videoPacket.codecId) {
        default:
          throw 'unsupported video codec: ' + videoPacket.codecDescription;
        case VP6_VIDEO_CODEC_ID:
          if (videoPacket.frameType === 1 && this.cachedPackets !== 0) // keyframe
            this.chunk();
          break; // supported
        case AVC_VIDEO_CODEC_ID:
          if (videoPacket.packetType !== 0 && this.state === 0)
            this.generateHeader();
          if (videoPacket.frameType === 1 && this.cachedPackets !== 0) // keyframe
            this.chunk();
        }
        this.tracks[this.videoTrackId].cache.push(videoPacket);
        this.cachedPackets++;
        break;
      default:
        throw 'unknown packet type: ' + type;
      }

      if (this.cachedPackets >= MAX_PACKETS_IN_CHUNK) {
        this.chunk();
      }
    },
    flush: function () {
      if (this.cachedPackets > 0) {
        this.chunk();
      }
    },
    generateHeader: function () {
      var ftype = hex('000000206674797069736F6D0000020069736F6D69736F32617663316D703431');

      var metadata = this.metadata;
      var traks = [];
      for (var i = 0; i < this.tracks.length; i++) {
        var trak;
        var trackInfo = this.tracks[i], trackId = i + 1;
        var isAudio;
        switch (trackInfo.type) {
        case 'mp4a':
          var audioSpecificConfig = trackInfo.cache[0].data;
          codecInfo = tag('mp4a', [
            hex('00000000000000010000000000000000'), encodeUint16(trackInfo.channels), hex('00100000'), encodeInt32(trackInfo.samplerate), hex('0000'),
            tag('esds', [hex('000000000380808022000200048080801440150000000000FA000000000005808080'), audioSpecificConfig.length, audioSpecificConfig, hex('068080800102')])
          ]);
          isAudio = true;
          break;
        case 'mp3':
          codecInfo = tag('.mp3', [
            hex('00000000000000010000000000000000'), encodeUint16(trackInfo.channels), hex('00100000'), encodeInt32(trackInfo.samplerate), hex('0000')
          ]);
          isAudio = true;
          break;
        case 'avc1':
          var avcC = trackInfo.cache[0].data;
          codecInfo = tag('avc1', [
            hex('000000000000000100000000000000000000000000000000'), encodeUint16(trackInfo.width), encodeUint16(trackInfo.height), hex('004800000048000000000000000100000000000000000000000000000000000000000000000000000000000000000018FFFF'),
            tag('avcC', avcC)
          ]);
          isAudio = false;
          break;
        case 'vp6f':
          codecInfo = tag('VP6F', [
            hex('000000000000000100000000000000000000000000000000'), encodeUint16(trackInfo.width), encodeUint16(trackInfo.height), hex('004800000048000000000000000100000000000000000000000000000000000000000000000000000000000000000018FFFF'),
            tag('glbl', [hex('00')])
          ]);
          isAudio = false;
          break;
        default:
          throw 'not supported';
        }

        if (isAudio) {
          trak = tag('trak', [
            hex('0000005C746B68640000000F0000000000000000'), encodeInt32(trackId), hex('00000000FFFFFFFF00000000000000000000'), encodeUint16(i /*altgroup*/), encodeFloat16(1.0 /*volume*/), hex('0000000100000000000000000000000000000001000000000000000000000000000040000000'), encodeFloat(0/*width*/), encodeFloat(0/*height*/),
            tag('mdia', [
              hex('000000206D6468640000000000000000000000000000'), encodeUint16(trackInfo.timescale), hex('FFFFFFFF'), encodeLang(trackInfo.language), hex('00000000002D68646C720000000000000000736F756E000000000000000000000000536F756E6448616E646C657200'),
                tag('minf', [
                hex('00000010736D686400000000000000000000002464696E660000001C6472656600000000000000010000000C75726C2000000001'),
                tag('stbl', [
                  tag('stsd', [hex('0000000000000001'), codecInfo]),
                  hex('0000001073747473000000000000000000000010737473630000000000000000000000147374737A000000000000000000000000000000107374636F0000000000000000')
                ])
              ])
            ])
          ]);
        } else { // isVideo
          trak = tag('trak', [
            hex('0000005C746B68640000000F0000000000000000'), encodeInt32(trackId), hex('00000000FFFFFFFF00000000000000000000'), encodeUint16(i /*altgroup*/), encodeFloat16(0 /*volume*/), hex('0000000100000000000000000000000000000001000000000000000000000000000040000000'), encodeFloat(trackInfo.width), encodeFloat(trackInfo.height),
            tag('mdia', [
              hex('000000206D6468640000000000000000000000000000'), encodeUint16(trackInfo.timescale), hex('FFFFFFFF'), encodeLang(trackInfo.language), hex('00000000002D68646C72000000000000000076696465000000000000000000000000566964656F48616E646C657200'),
              tag('minf', [
                hex('00000014766D68640000000100000000000000000000002464696E660000001C6472656600000000000000010000000C75726C2000000001'),
                tag('stbl', [
                  tag('stsd', [hex('0000000000000001'), codecInfo]),
                  hex('0000001073747473000000000000000000000010737473630000000000000000000000147374737A000000000000000000000000000000107374636F0000000000000000')
                ])
              ])
            ])
          ]);
        }

        trackInfo.cache = [];
        traks.push(trak);
      }
      this.cachedPackets = 0;

      var mvexAndUdat = hex('000000486D7665780000002074726578000000000000000100000001000000000000000000000000000000207472657800000000000000020000000100000000000000000000000000000062756474610000005A6D657461000000000000002168646C7200000000000000006D6469726170706C0000000000000000000000002D696C737400000025A9746F6F0000001D6461746100000001000000004C61766635342E36332E313034');
      var moovHeader = [hex('0000006C6D766864000000000000000000000000000003E80000000000010000010000000000000000000000000100000000000000000000000000000001000000000000000000000000000040000000000000000000000000000000000000000000000000000000'), encodeInt32(this.tracks.length)];
      var moov = tag('moov', [moovHeader, traks, mvexAndUdat]);
      var header = flatten([ftype, moov]);
      this.ondata(header);
      this.filePos += header.length;
      this.state = 1;
    },
    chunk: function () {
      var moofOffset = flatten([hex('00000000'), encodeInt32(this.filePos)]); // TODO
      var trafParts = [], tdatParts = [];

      var moofHeader = flatten([hex('000000106D66686400000000'), encodeInt32(++this.chunkIndex)]);
      var moof = [moofHeader];
      var moofLength = 8 + moofHeader.length + /* trafs len */ + 8;

      for (var i = 0; i < this.tracks.length; i++) {
        var trak;
        var trackInfo = this.tracks[i], trackId = i + 1;
        if (trackInfo.cache.length === 0)
          continue;
        switch (trackInfo.type) {
        case 'mp4a':
        case 'mp3':
          var trun1head = flatten([hex('00000305'), encodeInt32(trackInfo.cache.length)]);
          var trun1tail = [hex('02000000')];
          var tdat1 = [];
          for (var j = 0; j < trackInfo.cache.length; j++) {
            var audioFrameDuration = (trackInfo.cache[j].samples / trackInfo.samplerate * trackInfo.timescale) | 0;
            tdat1.push(trackInfo.cache[j].data);
            trun1tail.push(encodeInt32(audioFrameDuration), encodeInt32(trackInfo.cache[j].data.length));
          }
          trun1tail = flatten(trun1tail);
          tdat1 = flatten(tdat1);
          var tfhd1 = tag('tfhd', [hex('00000039'), encodeInt32(trackId), moofOffset, hex('000004000000001A02000000')]);
          moofLength += 8 + tfhd1.length + 8 + trun1head.length + 4 + trun1tail.length;
          trafParts.push({tfhd: tfhd1, trunHead: trun1head, trunTail: trun1tail});
          tdatParts.push(tdat1);
          break;
       case 'avc1':
       case 'vp6f':
          var videoFrameDuration = (trackInfo.timescale / trackInfo.framerate) | 0;
          var firstFrameFlags = trackInfo.cache[0].frameType !== 1 ? hex('01010000') : hex('02000000');
          var trun2head = flatten([hex('00000A05'), encodeInt32(trackInfo.cache.length)]);
          var trun2tail = [firstFrameFlags];
          var tdat2 = [];
          for (var j = 0; j < trackInfo.cache.length; j++) {
            tdat2.push(trackInfo.cache[j].data);
            trun2tail.push(encodeInt32(trackInfo.cache[j].data.length), encodeInt32(trackInfo.cache[j].compositionTime));
          }
          trun2tail = flatten(trun2tail);
          tdat2 = flatten(tdat2);
          var tfhd2 = tag('tfhd', [hex('00000039'), encodeInt32(trackId), moofOffset, encodeInt32(videoFrameDuration), hex('0000127B01010000')]);
          moofLength += 8 + tfhd2.length + 8 + trun2head.length + 4 + trun2tail.length;
          trafParts.push({tfhd: tfhd2, trunHead: trun2head, trunTail: trun2tail});
          tdatParts.push(tdat2);
          break;
        default:
          throw 'unsupported codec';
        }
        trackInfo.cache = [];
      }

      var moofParts = [moofHeader], tdatOffset = moofLength;
      for (var i = 0; i < trafParts.length; i++) {
        var traf = tag('traf', [trafParts[i].tfhd,
          tag('trun', [trafParts[i].trunHead, encodeInt32(tdatOffset), trafParts[i].trunTail]) ]);
        moofParts.push(traf);
        tdatOffset += tdatParts[i].length;
      }

      var chunk = flatten([tag('moof', moofParts), tag('tdat', tdatParts)]);
      this.ondata(chunk);
      this.filePos += chunk.length;
      this.cachedPackets = 0;
    },
    ondata: function (data) { throw 'not implemented'; }
  };

  return MP4Mux;
})();
