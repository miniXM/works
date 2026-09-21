const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFfmpegArgs } = require('../backend/render.cjs');

test('timeline renderer builds deterministic cross-platform FFmpeg concat command', () => {
  const payload = { timeline: { width: 1080, height: 1920, tracks: [{ clips: [
    { type: 'FFMPEGVideoClip', data: { start: 3, duration: 2, file_url: '/tmp/b.mp4' } },
    { type: 'FFMPEGVideoClip', data: { start: 0, duration: 3, trim_start: 1, file_url: '/tmp/a.mp4' } },
    { type: 'FFMPEGAudioClip', data: { start: 1.5, duration: 2, volume: 0.8, file_url: '/tmp/voice.mp3' } }
  ] }] }, exporter: { fps: 25, encoder: 'libx264', video_bitrate: '4M', output_file: '/tmp/out.mp4' } };
  const { args, output } = buildFfmpegArgs(payload);
  assert.equal(output, '/tmp/out.mp4');
  assert.ok(args.indexOf('/tmp/a.mp4') < args.indexOf('/tmp/b.mp4'));
  assert.ok(args.includes('concat=n=2:v=1:a=0[outv]') === false);
  assert.match(args[args.indexOf('-filter_complex') + 1], /concat=n=2:v=1:a=0\[outv\]/);
  assert.ok(args.includes('1080:1920:force_original_aspect_ratio=decrease') === false);
  assert.match(args[args.indexOf('-filter_complex') + 1], /scale=1080:1920/);
  assert.match(args[args.indexOf('-filter_complex') + 1], /adelay=1500\|1500/);
  assert.ok(args.includes('[outa]'));
});

test('timeline renderer rejects an empty timeline', () => {
  assert.throws(() => buildFfmpegArgs({ timeline: { tracks: [] }, exporter: { output_file: '/tmp/out.mp4' } }), /没有可合成/);
});
