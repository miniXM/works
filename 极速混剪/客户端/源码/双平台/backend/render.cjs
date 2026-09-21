const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function filePath(value) {
  const text = String(value || '');
  if (!text.startsWith('file:')) return text;
  return require('node:url').fileURLToPath(text);
}

function videoClips(timeline) {
  return (timeline?.tracks || []).flatMap((track) => track?.clips || []).filter((clip) => clip?.type === 'FFMPEGVideoClip' && clip?.data?.file_url).sort((a, b) => Number(a.data.start || 0) - Number(b.data.start || 0));
}

function audioClips(timeline) {
  return (timeline?.tracks || []).flatMap((track) => track?.clips || []).filter((clip) => clip?.type === 'FFMPEGAudioClip' && clip?.data?.file_url).sort((a, b) => Number(a.data.start || 0) - Number(b.data.start || 0));
}

function buildFfmpegArgs(payload) {
  const timeline = payload?.timeline || {};
  const clips = videoClips(timeline);
  const audios = audioClips(timeline);
  if (!clips.length) throw new Error('没有可合成的视频片段');
  const width = Math.max(16, Math.round(Number(timeline.width) || 1920));
  const height = Math.max(16, Math.round(Number(timeline.height) || 1080));
  const fps = Math.max(1, Math.round(Number(payload?.exporter?.fps) || 30));
  const output = filePath(payload?.exporter?.output_file);
  if (!output) throw new Error('缺少输出文件路径');
  const args = ['-hide_banner', '-y'];
  for (const clip of clips) {
    const trim = Math.max(0, Number(clip.data.trim_start) || 0);
    const duration = Math.max(0.05, Number(clip.data.duration) || 0.05);
    if (trim) args.push('-ss', String(trim));
    args.push('-t', String(duration), '-i', filePath(clip.data.file_url));
  }
  for (const clip of audios) args.push('-i', filePath(clip.data.file_url));
  const filters = clips.map((_clip, index) => `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[v${index}]`);
  filters.push(`${clips.map((_clip, index) => `[v${index}]`).join('')}concat=n=${clips.length}:v=1:a=0[outv]`);
  if (audios.length) {
    audios.forEach((clip, index) => {
      const input = clips.length + index;
      const duration = Math.max(0.05, Number(clip.data.duration) || 0.05);
      const delay = Math.max(0, Math.round((Number(clip.data.start) || 0) * 1000));
      const volume = Math.max(0, Number(clip.data.volume) || 0);
      filters.push(`[${input}:a]atrim=0:${duration},asetpts=PTS-STARTPTS,volume=${volume},adelay=${delay}|${delay}[a${index}]`);
    });
    filters.push(`${audios.map((_clip, index) => `[a${index}]`).join('')}amix=inputs=${audios.length}:duration=longest:normalize=0[outa]`);
  }
  args.push('-filter_complex', filters.join(';'), '-map', '[outv]');
  if (audios.length) args.push('-map', '[outa]', '-c:a', 'aac', '-b:a', '192k');
  args.push('-c:v', String(payload?.exporter?.encoder || 'libx264'), '-b:v', String(payload?.exporter?.video_bitrate || '3M'), '-movflags', '+faststart', output);
  return { args, output };
}

async function renderTimeline(payload, onProgress = () => {}) {
  const { args, output } = buildFfmpegArgs(payload);
  await fs.promises.mkdir(path.dirname(output), { recursive: true });
  let ffmpeg;
  if (process.env.FFMPEG_PATH) ffmpeg = process.env.FFMPEG_PATH;
  else try { ffmpeg = require('@ffmpeg-installer/ffmpeg').path; } catch { ffmpeg = 'ffmpeg'; }
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true });
    let errorText = '';
    child.stderr.on('data', (chunk) => { errorText = (errorText + chunk.toString()).slice(-12000); onProgress(50); });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg 合成失败 (${code}): ${errorText.slice(-800)}`)));
  });
  onProgress(100);
  return output;
}

module.exports = { audioClips, buildFfmpegArgs, renderTimeline, videoClips };
