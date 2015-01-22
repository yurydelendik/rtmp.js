/**
 * Copyright 2015 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

module RtmpJs.MP4 {
  function hex(s: string): Uint8Array {
    var len = s.length >> 1;
    var arr = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
      arr[i] = parseInt(s.substr(i * 2, 2), 16);
    }
    return arr;
  }

  var SOUNDRATES = [5500, 11025, 22050, 44100];
  var SOUNDFORMATS = ['PCM', 'ADPCM', 'MP3', 'PCM le', 'Nellymouser16', 'Nellymouser8', 'Nellymouser', 'G.711 A-law', 'G.711 mu-law', null, 'AAC', 'Speex', 'MP3 8khz'];
  var MP3_SOUND_CODEC_ID = 2;
  var AAC_SOUND_CODEC_ID = 10;

  enum AudioPacketType {
    HEADER = 0,
    RAW = 1,
  }

  interface AudioPacket {
    codecDescription: string;
    codecId: number;
    data: Uint8Array;
    rate: number;
    size: number;
    channels: number;
    samples: number;
    packetType: AudioPacketType;
  }

  function parseAudiodata(data: Uint8Array): AudioPacket {
    var i = 0;
    var packetType = AudioPacketType.RAW;
    var codecId = data[i] >> 4;
    var samples: number;
    i++;
    switch (codecId) {
      case AAC_SOUND_CODEC_ID:
        var type = data[i++];
        packetType = <AudioPacketType>type;
        samples = 1024; // ????
        break;
      case MP3_SOUND_CODEC_ID:
        var version = (data[i + 1] >> 3) & 3; // 3 - MPEG 1
        var layer = (data[i + 1] >> 1) & 3; // 3 - Layer I, 2 - II, 1 - III
        samples = layer === 1 ? (version === 3 ? 1152 : 576) :
          (layer === 3 ? 384 : 1152);
        break;
    }
    var data = data.subarray(i);
    return {
      codecDescription: SOUNDFORMATS[codecId],
      codecId: codecId,
      data: data,
      rate: SOUNDRATES[(data[i] >> 2) & 3],
      size: data[i] & 2 ? 16 : 8,
      channels: data[i] & 1 ? 2 : 1,
      samples: samples,
      packetType: packetType
    };
  }

  var VIDEOCODECS = [null, 'JPEG', 'Sorenson', 'Screen', 'VP6', 'VP6 alpha', 'Screen2', 'AVC'];
  var VP6_VIDEO_CODEC_ID = 4;
  var AVC_VIDEO_CODEC_ID = 7;

  enum VideoFrameType {
    KEY = 1,
    INNER = 2,
    DISPOSABLE = 3,
    GENERATED = 4,
    INFO = 5,
  }

  enum VideoPacketType {
    HEADER = 0,
    NALU = 1,
    END = 2,
  }

  interface VideoPacket {
    frameType: VideoFrameType;
    codecId: number;
    codecDescription: string;
    data: Uint8Array;
    packetType?: VideoPacketType;
    compositionTime?: number;
    horizontalOffset?: number;
    verticalOffset?: number;
  }

  function parseVideodata(data: Uint8Array): VideoPacket {
    var i = 0;
    var frameType = data[i] >> 4;
    var codecId = data[i] & 15;
    i++;
    var result: any = {
      frameType: <VideoFrameType>frameType,
      codecId: codecId,
      codecDescription: VIDEOCODECS[codecId]
    };
    switch (codecId) {
      case AVC_VIDEO_CODEC_ID:
        var type = data[i++];
        result.packetType = <VideoPacketType>type;
        result.compositionTime = ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8)) >> 8;
        i += 3;
        break;
      case VP6_VIDEO_CODEC_ID:
        result.packetType = VideoPacketType.NALU;
        result.horizontalOffset = (data[i] >> 4) & 15;
        result.verticalOffset = data[i] & 15;
        i++;
        break;
    }
    result.data = data.subarray(i);
    return result;
  }

  var AUDIO_PACKET = 8;
  var VIDEO_PACKET = 9;
  var MAX_PACKETS_IN_CHUNK = 50;
  var SPLIT_AT_KEYFRAMES = true;

  interface CachedPacket {
    packet: any;
    timestamp: number;
  }

  interface MP4Track {
    language: string;
    type: string;
    timescale: number;
    cache: CachedPacket[];
    cachedDuration: number;

    samplerate?: number;
    channels?: number;
    samplesize?: number;

    framerate?: number;
    width?: number;
    height?: number;

    initializationData?: Uint8Array[];
  }

  interface MP4Metadata {
    tracks: MP4Track[];
    duration: number;
    audioTrackId: number;
    videoTrackId: number;
  }

  function parseMetadata(metadata): MP4Metadata {
    var tracks: MP4Track[] = [];
    var audioTrackId = -1;
    var videoTrackId = -1;
    var duration = +metadata.asGetPublicProperty('duration');

    if (metadata.asGetPublicProperty('trackinfo')) {
      // Not in the Adobe's references, red5 specific?
      for (var i = 0; i < metadata.asGetPublicProperty('trackinfo').length; i++) {
        var info = metadata.asGetPublicProperty('trackinfo')[i];
        var track: MP4Track = {
          language: info.asGetPublicProperty('language'),
          type: info.asGetPublicProperty('sampledescription')[0].asGetPublicProperty('sampletype'),
          timescale: info.asGetPublicProperty('timescale'),
          cache: [],
          cachedDuration: 0,
          initializationData: []
        };
        if (info.asGetPublicProperty('sampledescription')[0].asGetPublicProperty('sampletype') === metadata.asGetPublicProperty('audiocodecid')) {
          audioTrackId = i;
          track.samplerate = +metadata.asGetPublicProperty('audiosamplerate');
          track.channels = +metadata.asGetPublicProperty('audiochannels');
          track.samplesize = 16;
        } else if (info.asGetPublicProperty('sampledescription')[0].asGetPublicProperty('sampletype')  === metadata.asGetPublicProperty('videocodecid')) {
          videoTrackId = i;
          track.framerate = +metadata.asGetPublicProperty('videoframerate');
          track.width = +metadata.asGetPublicProperty('width');
          track.height = +metadata.asGetPublicProperty('height');
        }
        tracks.push(track);
      }
    } else {
      if (metadata.asGetPublicProperty('audiocodecid')) {
        if (metadata.asGetPublicProperty('audiocodecid') !== 2) {
          throw new Error('unsupported audio codec: ' + metadata.asGetPublicProperty('audiocodec'));
        }
        audioTrackId = tracks.length;
        tracks.push({
          language: "unk",
          type: "mp3",
          timescale: +metadata.asGetPublicProperty('audiosamplerate') || 44100,
          samplerate: +metadata.asGetPublicProperty('audiosamplerate') || 44100,
          channels: +metadata.asGetPublicProperty('audiochannels') || 2,
          samplesize: 16,
          cache: [],
          cachedDuration: 0
        });
      }
      if (metadata.asGetPublicProperty('videocodecid')) {
        if (metadata.asGetPublicProperty('videocodecid') !== 4) {
          throw new Error('unsupported video codec: ' + metadata.asGetPublicProperty('videocodecid'));
        }
        videoTrackId = tracks.length;
        tracks.push({
          language: "unk",
          type: "vp6f",
          timescale: 10000,
          framerate: +metadata.asGetPublicProperty('framerate'),
          width: +metadata.asGetPublicProperty('width'),
          height: +metadata.asGetPublicProperty('height'),
          cache: [],
          cachedDuration: 0
        });
      }
    }
    return {
      tracks: tracks,
      duration: duration,
      audioTrackId: audioTrackId,
      videoTrackId: videoTrackId
    };
  }

  enum MP4MuxState {
    CAN_GENERATE_HEADER = 0,
    NEED_HEADER_DATA = 1,
    MAIN_PACKETS = 2
  }

  export class MP4Mux {
    private metadata: MP4Metadata;

    private filePos: number;
    private cachedPackets: number;
    private state: MP4MuxState;
    private chunkIndex: number;

    ondata: (data) => void = function (data) {
      throw new Error('MP4Mux.ondata is not set');
    };

    public constructor(metadata) {
      this.metadata = parseMetadata(metadata);
      this._checkIfNeedHeaderData();

      this.filePos = 0;
      this.cachedPackets = 0;
      this.chunkIndex = 0;
    }

    public pushPacket(type: number, data: Uint8Array, timestamp: number) {
      if (this.state === MP4MuxState.CAN_GENERATE_HEADER) {
        this._tryGenerateHeader();
      }

      switch (type) {
        case AUDIO_PACKET: // audio
          var audioTrack = this.metadata.tracks[this.metadata.audioTrackId];
          var audioPacket = parseAudiodata(data);
          switch (audioPacket.codecId) {
            default:
              throw new Error('unsupported audio codec: ' + audioPacket.codecDescription);
            case MP3_SOUND_CODEC_ID:
              break; // supported codec
            case AAC_SOUND_CODEC_ID:
              if (audioPacket.packetType === AudioPacketType.HEADER) {
                audioTrack.initializationData.push(audioPacket.data);
                return;
              }
              break;
          }
          audioTrack.cache.push({packet: audioPacket, timestamp: timestamp});
          this.cachedPackets++;
          break;
        case VIDEO_PACKET:
          var videoTrack = this.metadata.tracks[this.metadata.videoTrackId];
          var videoPacket = parseVideodata(data);
          switch (videoPacket.codecId) {
            default:
              throw new Error('unsupported video codec: ' + videoPacket.codecDescription);
            case VP6_VIDEO_CODEC_ID:
              break; // supported
            case AVC_VIDEO_CODEC_ID:
              if (videoPacket.packetType === VideoPacketType.HEADER) {
                videoTrack.initializationData.push(videoPacket.data);
                return;
              }
              break;
          }
          videoTrack.cache.push({packet: videoPacket, timestamp: timestamp});
          this.cachedPackets++;
          break;
        default:
          throw new Error('unknown packet type: ' + type);
      }

      if (this.state === MP4MuxState.NEED_HEADER_DATA) {
        this._tryGenerateHeader();
      }
      if (this.cachedPackets >= MAX_PACKETS_IN_CHUNK &&
          this.state === MP4MuxState.MAIN_PACKETS) {
        this._chunk();
      }
    }

    public flush() {
      if (this.cachedPackets > 0) {
        this._chunk();
      }
    }

    private _checkIfNeedHeaderData() {
      var tracks = this.metadata.tracks;
      for (var i = 0; i < tracks.length; i++) {
        switch (tracks[i].type) {
          case 'mp4a':
          case 'avc1':
            this.state = MP4MuxState.NEED_HEADER_DATA;
            return;
        }
      }
      this.state = MP4MuxState.CAN_GENERATE_HEADER;
    }

    private _tryGenerateHeader() {
      var tracks = this.metadata.tracks;
      for (var i = 0; i < tracks.length; i++) {
        var trackInfo = tracks[i];
        switch (trackInfo.type) {
          case 'mp4a':
          case 'avc1':
            if (trackInfo.initializationData.length === 0) {
              return; // not enough data, waiting more
            }
            break;
        }
      }

      var ftype = new Iso.FileTypeBox('isom', 0x00000200, ['isom', 'iso2', 'avc1', 'mp41']);

      var audioDataReferenceIndex = 1, videoDataReferenceIndex = 1;
      var traks: Iso.TrackBox[] = [];
      for (var i = 0; i < tracks.length; i++) {
        var trackInfo = tracks[i], trackId = i + 1;
        var isAudio;
        var sampleEntry: Iso.SampleEntry;
        switch (trackInfo.type) {
          case 'mp4a':
            var audioSpecificConfig = trackInfo.initializationData[0];
            sampleEntry = new Iso.AudioSampleEntry('mp4a', audioDataReferenceIndex, trackInfo.channels, trackInfo.samplesize, trackInfo.samplerate);

            var esdsData = new Uint8Array(41 + audioSpecificConfig.length);
            esdsData.set(hex('0000000003808080'), 0);
            esdsData[8] = 32 + audioSpecificConfig.length;
            esdsData.set(hex('00020004808080'), 9);
            esdsData[16] = 18 + audioSpecificConfig.length;
            esdsData.set(hex('40150000000000FA000000000005808080'), 17);
            esdsData[34] = audioSpecificConfig.length;
            esdsData.set(audioSpecificConfig, 35);
            esdsData.set(hex('068080800102'), 35 + audioSpecificConfig.length);
            (<Iso.AudioSampleEntry>sampleEntry).otherBoxes = [
              new Iso.RawTag('esds', esdsData)
            ];
            isAudio = true;
            break;
          case 'mp3':
            sampleEntry = new Iso.AudioSampleEntry('.mp3', audioDataReferenceIndex, trackInfo.channels, trackInfo.samplesize, trackInfo.samplerate);
            isAudio = true;
            break;
          case 'avc1':
            var avcC = trackInfo.initializationData[0];
            sampleEntry = new Iso.VideoSampleEntry('avc1', videoDataReferenceIndex, trackInfo.width, trackInfo.height);
            (<Iso.VideoSampleEntry>sampleEntry).otherBoxes = [
              new Iso.RawTag('avcC', avcC)
            ];
            isAudio = false;
            break;
          case 'vp6f':
            sampleEntry = new Iso.VideoSampleEntry('VP6F', videoDataReferenceIndex, trackInfo.width, trackInfo.height);
            (<Iso.VideoSampleEntry>sampleEntry).otherBoxes = [
              new Iso.RawTag('glbl', hex('00'))
            ];
            isAudio = false;
            break;
          default:
            throw new Error('not supported track type');
        }

        var trak;
        if (isAudio) {
          trak = new Iso.TrackBox(
            new Iso.TrackHeaderBox(0x00000F, trackId, -1, 0 /*width*/, 0 /*height*/, 1.0, i),
            new Iso.MediaBox(
              new Iso.MediaHeaderBox(trackInfo.timescale, -1, trackInfo.language),
              new Iso.HandlerBox('soun', 'SoundHandler'),
              new Iso.MediaInformationBox(
                new Iso.SoundMediaHeaderBox(),
                new Iso.DataInformationBox(
                  new Iso.DataReferenceBox([new Iso.DataEntryUrlBox(Iso.SELF_CONTAINED_DATA_REFERENCE_FLAG)])),
                new Iso.SampleTableBox(
                  new Iso.SampleDescriptionBox([sampleEntry]),
                  new Iso.RawTag('stts', hex('0000000000000000')),
                  new Iso.RawTag('stsc', hex('0000000000000000')),
                  new Iso.RawTag('stsz', hex('000000000000000000000000')),
                  new Iso.RawTag('stco', hex('0000000000000000'))
                )
              )
            )
          );
        } else { // isVideo
          trak = new Iso.TrackBox(
            new Iso.TrackHeaderBox(0x00000F, trackId, -1, trackInfo.width, trackInfo.height, 0 /* volume */, i),
            new Iso.MediaBox(
              new Iso.MediaHeaderBox(trackInfo.timescale, -1, trackInfo.language),
              new Iso.HandlerBox('vide', 'VideoHandler'),
              new Iso.MediaInformationBox(
                new Iso.VideoMediaHeaderBox(),
                new Iso.DataInformationBox(
                  new Iso.DataReferenceBox([new Iso.DataEntryUrlBox(Iso.SELF_CONTAINED_DATA_REFERENCE_FLAG)])),
                new Iso.SampleTableBox(
                  new Iso.SampleDescriptionBox([sampleEntry]),
                  new Iso.RawTag('stts', hex('0000000000000000')),
                  new Iso.RawTag('stsc', hex('0000000000000000')),
                  new Iso.RawTag('stsz', hex('000000000000000000000000')),
                  new Iso.RawTag('stco', hex('0000000000000000'))
                )
              )
            )
          );
        }
        traks.push(trak);
      }

      var mvex = new Iso.MovieExtendsBox(null, [
        new Iso.TrackExtendsBox(1, 1, 0, 0, 0),
        new Iso.TrackExtendsBox(2, 1, 0, 0, 0)
      ], null);
      var udat = new Iso.BoxContainerBox('udat', [
        new Iso.MetaBox(
          new Iso.RawTag('hdlr', hex('00000000000000006D6469726170706C000000000000000000')), // notice weird stuff in reserved field
          [new Iso.RawTag('ilst', hex('00000025A9746F6F0000001D6461746100000001000000004C61766635342E36332E313034'))]
        )
      ]);
      var mvhd = new Iso.MovieHeaderBox(1000, 0 /* unknown duration */, tracks.length);
      var moov = new Iso.MovieBox(mvhd, traks, mvex, udat);

      var ftypeSize = ftype.layout(0);
      var moovSize = moov.layout(ftypeSize);

      var header = new Uint8Array(ftypeSize + moovSize);
      ftype.write(header);
      moov.write(header);

      this.ondata(header);
      this.filePos += header.length;
      this.state = MP4MuxState.MAIN_PACKETS;
    }

    _chunk() {
      var tracks = this.metadata.tracks;
      var tdatParts: Uint8Array[] = [];
      var tdatPosition: number = 0;
      var trafs: Iso.TrackFragmentBox[] = [];
      var trafDataStarts: number[] = [];

      var moofHeader = new Iso.MovieFragmentHeaderBox(++this.chunkIndex);
      for (var i = 0; i < tracks.length; i++) {
        var trackInfo = tracks[i], trackId = i + 1;
        var cachedPackets: CachedPacket[] = trackInfo.cache;
        if (cachedPackets.length === 0) {
          continue;
        }

        //var currentTrackTime = (cachedPackets[0].timestamp * trackInfo.timescale / 1000) | 0;
        //var tfdt = new Iso.TrackFragmentBaseMediaDecodeTimeBox(currentTrackTime);
        var tfdt = new Iso.TrackFragmentBaseMediaDecodeTimeBox(trackInfo.cachedDuration);
        var tfhd: Iso.TrackFragmentHeaderBox;
        var trun: Iso.TrackRunBox;
        var trunSamples: Iso.TrackRunSample[];

        var totalDuration = 0;
        trafDataStarts.push(tdatPosition);
        switch (trackInfo.type) {
          case 'mp4a':
          case 'mp3':
            trunSamples = [];
            for (var j = 0; j < cachedPackets.length; j++) {
              var audioPacket: AudioPacket = cachedPackets[j].packet;
              var audioFrameDuration = (audioPacket.samples / trackInfo.samplerate * trackInfo.timescale) | 0;
              tdatParts.push(audioPacket.data);
              tdatPosition += audioPacket.data.length;
              trunSamples.push({duration: audioFrameDuration, size: audioPacket.data.length});
              totalDuration += audioFrameDuration;
            }
            this.cachedPackets -= cachedPackets.length;
            cachedPackets.length = 0; // removed all audio packets
            tfhd = new Iso.TrackFragmentHeaderBox(0x020038, trackId, 0 /* offset */, 0 /* index */, 0x00000400 /* ? */, 0x0000001A /* sample size ? */, 0x02000000);
            trun = new Iso.TrackRunBox(0x000305, trunSamples, 0, 0x02000000);
            break;
          case 'avc1':
          case 'vp6f':
            var packetsToProcess = cachedPackets.length;
            if (SPLIT_AT_KEYFRAMES) {
              var j = packetsToProcess;
              while (j > 0 && cachedPackets[j - 1].packet.frameType !== VideoFrameType.KEY) {
                j--;
              }
              if (j <= 0) { // we have only non-keyframes...
                continue; // skipping writing these packets
              }
              packetsToProcess = j;
            }
            var videoFrameDuration = (trackInfo.timescale / trackInfo.framerate) | 0;
            trunSamples = [];
            totalDuration = packetsToProcess * videoFrameDuration;
            for (var j = 0; j < packetsToProcess; j++) {
              var videoPacket: VideoPacket = cachedPackets[j].packet;
              tdatParts.push(videoPacket.data);
              tdatPosition += videoPacket.data.length;
              var frameFlags = cachedPackets[j].packet.frameType !== VideoFrameType.KEY ? 0x01010000 : 0x02000000;
              trunSamples.push({size: videoPacket.data.length, flags: frameFlags, compositionTimeOffset: videoPacket.compositionTime});
            }
            this.cachedPackets -= packetsToProcess;
            cachedPackets.splice(0, packetsToProcess); // removed processed video packets
            tfhd = new Iso.TrackFragmentHeaderBox(0x020038, trackId, 0 /* offset */, 0 /* index */, videoFrameDuration, 0x0000127B /* sample size ? */, 0x01010000);
            trun = new Iso.TrackRunBox(0x000E01, trunSamples, 0, 0);
            break;
          default:
            throw new Error('unsupported codec');
        }
        trackInfo.cachedDuration += totalDuration;
        trackInfo.cache = [];

        var traf = new Iso.TrackFragmentBox(tfhd, tfdt, trun);
        trafs.push(traf);
      }
      if (trafs.length === 0) {
        return; // no data to produce
      }

      var moof = new Iso.MovieFragmentBox(moofHeader, trafs);
      var moofSize = moof.layout(0);
      var mdat = new Iso.MediaDataBox(tdatParts);
      var mdatSize = mdat.layout(moofSize);

      var tdatOffset = moofSize + 8 /* 'mdat' header size */;
      for (var i = 0; i < trafs.length; i++) {
        trafs[i].run.dataOffset = tdatOffset + trafDataStarts[i];
      }

      var chunk = new Uint8Array(moofSize + mdatSize);
      moof.write(chunk);
      mdat.write(chunk);

      this.ondata(chunk);
      this.filePos += chunk.length;
    }
  }

}
