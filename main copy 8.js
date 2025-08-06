//all the functionalities for default audio are working abosolutely fine
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');
const ffmpeg = require('fluent-ffmpeg');
const { exec } = require('child_process');
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.mp4'];

const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowedExts.includes(ext));
  },
  limits: { files: 10 }
});

app.get('/', (req, res) => {
  res.render('index');
});

// Function to get the duration of an audio file
function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) {
        console.error(`Error getting audio duration: ${err}`);
        reject(err);
      } else {
        const duration = metadata.format.duration;
        console.log(`Audio duration: ${duration}`);
        resolve(duration);
      }
    });
  });
}

// Silent video from image
function imageToSilentVideoWithFade(inputPath, outputPath, duration = 6, resolution = '1080x1920') {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(inputPath)
      .loop()
      .duration(duration)
      .videoCodec('libx264')
      .outputOptions([
        `-vf scale=${resolution},format=yuv420p,fade=t=in:st=0:d=0.25,fade=t=out:st=${duration - 0.25}:d=0.25`, '-r 30',
        '-pix_fmt yuv420p',
        '-an'
      ])
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}

// Function to generate AI audio using Python script
function generateAIAudio(text, outputPath) {
  return new Promise((resolve, reject) => {
    const command = `python generate_audio.py "${text}" "${outputPath}"`;
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error generating AI audio: ${error}`);
        reject(error);
      } else {
        console.log(`AI audio generated successfully: ${stdout}`);
        resolve(outputPath);
      }
    });
  });
}

// Function to speed up audio using ffmpeg
function speedUpAudio(inputPath, outputPath, speedFactor = 1.3) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(inputPath)
      .audioFilter(`atempo=${speedFactor}`)
      .on('end', () => {
        console.log(`Audio speed adjusted successfully: ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (error) => {
        console.error(`Error adjusting audio speed: ${error}`);
        reject(error);
      })
      .save(outputPath);
  });
}

app.post('/upload', upload.array('media', 10), async (req, res) => {
  const caption = req.body.caption || '';
  const orientation = req.body.orientation || 'portrait';
  const resolution = orientation === 'portrait' ? '1080x1920' : '1920x1080';
  const ts = Date.now();
  const tempDir = path.join(__dirname, 'temp');
  const archiveDir = path.join(__dirname, 'archive', ts.toString());
  const finalVideoPath = path.join(__dirname, `output_${ts}.mp4`);
  const silentVideoPath = finalVideoPath.replace('.mp4', '_silent.mp4');
  const musicOption = req.body.music_option || 'default';
  let audioPath, audioDuration, chunkDuration = 6, numberOfChunks, captionChunks = [], wordsPerChunk;

  // Initialize mediaFiles from req.files
  const mediaFiles = req.files || [];

  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });

  if (musicOption === 'ai') {
    audioPath = path.join(tempDir, 'ai-bg-music.mp3');
    // Generate AI audio from caption
    await generateAIAudio(caption, audioPath);
    // Get the duration of the AI audio
    audioDuration = await getAudioDuration(audioPath);
    // Calculate the number of chunks based on the audio duration
    numberOfChunks = Math.ceil(audioDuration / chunkDuration);
    // Split the caption into chunks based on the number of chunks
    const words = caption.split(/\s+/).filter(Boolean);
    wordsPerChunk = Math.ceil(words.length / numberOfChunks);
    for (let i = 0; i < words.length; i += wordsPerChunk) {
      captionChunks.push(words.slice(i, i + wordsPerChunk).join(' '));
    }
  } else {
    // Default music
    audioPath = path.join(__dirname, 'assets/default-bg-music.mp3');
    // Use default chunking logic (18 words per chunk)
    const words = caption.split(/\s+/).filter(Boolean);
    wordsPerChunk = 18;
    for (let i = 0; i < words.length; i += wordsPerChunk) {
      captionChunks.push(words.slice(i, i + wordsPerChunk).join(' '));
    }
    // Calculate total duration needed for silent video (max of chunks or images) * 6s
    const numChunks = captionChunks.length;
    const numImages = mediaFiles.filter(f => ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(f.originalname).toLowerCase())).length;
    const totalUnits = Math.max(numChunks, numImages);
    audioDuration = totalUnits * chunkDuration;
  }

  // Process images for caption chunks
  const processedMedia = [];
  const mediaCount = mediaFiles.length;

  for (let i = 0; i < captionChunks.length; i++) {
    let imgIdx = i % mediaCount;
    let file = mediaFiles[imgIdx];
    let ext = path.extname(file.originalname).toLowerCase();
    let tries = 0;
    while (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext) && tries < mediaCount) {
      imgIdx = (imgIdx + 1) % mediaCount;
      file = mediaFiles[imgIdx];
      ext = path.extname(file.originalname).toLowerCase();
      tries++;
    }
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) continue;

    const baseOutput = path.join(tempDir, `frame_${i}.png`);
    const videoOutput = path.join(tempDir, `clip_${i}.mp4`);
    const thisCaption = captionChunks[i];
    const [outW, outH] = resolution.split('x').map(Number);
    const bannerPath = path.join(__dirname, 'assets/shorts-bottom-banner.png');
    const bannerImg = await loadImage(bannerPath);
    const img = await loadImage(file.path);
    const canvas = createCanvas(outW, outH);
    const ctx = canvas.getContext('2d');

    // Draw the image and text on the canvas
    ctx.fillStyle = '#2d5072';
    ctx.fillRect(0, 0, outW, outH);
    const topH = Math.floor(outH / 3);
    ctx.fillStyle = 'rgba(43, 84, 111, 0.92)';
    ctx.fillRect(0, 0, outW, topH);
    const fontSize = Math.floor((topH / 4.2) * 0.7 * 0.7);
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'white';

    const wrapTextLines = (text, maxWidth, maxLines) => {
      const words = text.split(/\s+/);
      const lines = [];
      let line = '';
      for (let i = 0; i < words.length; i++) {
        const testLine = line ? line + ' ' + words[i] : words[i];
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && line) {
          lines.push(line);
          line = words[i];
          if (lines.length === maxLines - 1) break;
        } else {
          line = testLine;
        }
      }
      if (line && lines.length < maxLines) lines.push(line);
      return lines;
    };

    const lines = wrapTextLines(thisCaption, outW * 0.95, 7);
    for (let l = 0; l < lines.length; l++) {
      ctx.fillText(lines[l], outW / 2, topH / 2 + (l - (lines.length - 1) / 2) * fontSize * 1.1);
    }

    const midY = topH;
    const midH = Math.floor(outH / 3);
    const imgRatio = img.width / img.height;
    const midRatio = outW / midH;
    let drawW, drawH;
    if (imgRatio > midRatio) {
      drawW = outW;
      drawH = outW / imgRatio;
    } else {
      drawH = midH;
      drawW = midH * imgRatio;
    }
    ctx.drawImage(img, (outW - drawW) / 2, midY + (midH - drawH) / 2, drawW, drawH);

    const bannerH = outH - (topH + midH);
    ctx.drawImage(bannerImg, 0, outH - bannerH, outW, bannerH);

    const out = fs.createWriteStream(baseOutput);
    await new Promise((resolve, reject) => {
      const stream = canvas.createPNGStream();
      stream.pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
    });

    await imageToSilentVideoWithFade(baseOutput, videoOutput, chunkDuration, resolution);
    processedMedia.push(videoOutput);
  }

  // Process video clips and speed up their audio
  const videoClipPaths = [];
  for (let i = 0; i < mediaFiles.length; i++) {
    const file = mediaFiles[i];
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.mp4') continue;

    const [w, h] = resolution.split('x').map(Number);
    const resizedVideo = path.join(tempDir, `video_append_${i}.mp4`);
    const bottomBannerPath = path.join(__dirname, 'assets/shorts-bottom-banner.png');
    const topBannerPath = path.join(__dirname, 'assets/shorts-top-banner.png');

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(file.path)
        .input(bottomBannerPath)
        .input(topBannerPath)
        .complexFilter(`
          [0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=#2d5072,setsar=1[spedv];
          [1:v]scale=${w}:${Math.floor(h/3)}[bottombanner];
          [2:v]scale=${w}:${Math.floor(h/3)}[topbanner];
          [spedv][bottombanner]overlay=0:${h-Math.floor(h/3)}[withbottombanner];
          [withbottombanner][topbanner]overlay=0:0[finalv]
        `)
        .audioFilter('atempo=1.3') // Speed up the audio of the video clip
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          '-map', '[finalv]',
          '-map', '0:a?',
          '-pix_fmt', 'yuv420p',
          '-shortest'
        ])
        .on('end', resolve)
        .on('error', reject)
        .save(resizedVideo);
    });

    videoClipPaths.push(resizedVideo);
  }

  // Create silent+music video for captioned images
  const concatListPath = path.join(tempDir, `concat.txt`);
  fs.writeFileSync(concatListPath, processedMedia.map(p => `file '${p}'`).join('\n'));

  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(concatListPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y'])
      .output(silentVideoPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });

  // Use the audio without altering its speed
  await new Promise((resolve, reject) => {
    const ff = ffmpeg().input(silentVideoPath);
    ff.input(audioPath);
    if (musicOption !== 'ai') {
      ff.inputOptions(['-stream_loop', '-1']); // Loop default music if needed
    }
    ff.audioFilters('volume=0.5')
      .outputOptions([
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'copy',
        '-c:a', 'aac',
        `-t ${audioDuration}`
      ])
      .output(finalVideoPath)
      .on('end', () => {
        fs.unlinkSync(silentVideoPath);
        resolve();
      })
      .on('error', reject)
      .run();
  });

  // Concatenate video clips if any
  if (videoClipPaths.length > 0) {
    const finalConcatList = path.join(tempDir, 'final_concat.txt');
    const allVideos = [finalVideoPath, ...videoClipPaths];
    fs.writeFileSync(finalConcatList, allVideos.map(p => `file '${p}'`).join('\n'));
    const finalOutputPath = finalVideoPath.replace('.mp4', '_withclips.mp4');

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(finalConcatList)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy', '-y'])
        .output(finalOutputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    fs.renameSync(finalOutputPath, finalVideoPath);
    fs.unlinkSync(finalConcatList);
  }

  // Cleanup and response
  processedMedia.forEach(f => fs.unlinkSync(f));
  fs.unlinkSync(concatListPath);
  for (const file of req.files) {
    const dest = path.join(archiveDir, path.basename(file.path));
    if (fs.existsSync(file.path)) fs.renameSync(file.path, dest);
  }

  res.render('result', { videoName: path.basename(finalVideoPath) });
});

app.get('/video/:name', (req, res) => {
  const videoPath = path.join(__dirname, req.params.name);
  if (fs.existsSync(videoPath)) res.sendFile(videoPath);
  else res.status(404).send('Video not found.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running at http://localhost:${PORT}`));
