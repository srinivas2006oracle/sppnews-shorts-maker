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

// Function to process video clips
async function processVideoClip(file, tempDir, resolution, index) {
  return new Promise((resolve, reject) => {
    const [w, h] = resolution.split('x').map(Number);
    const resizedVideo = path.join(tempDir, `video_append_${index}.mp4`);
    const bottomBannerPath = path.join(__dirname, 'assets/shorts-bottom-banner.png');
    const topBannerPath = path.join(__dirname, 'assets/shorts-top-banner.png');

    ffmpeg()
      .input(file.path)
      .input(bottomBannerPath)
      .input(topBannerPath)
      .complexFilter(`
        [0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=#2d5072,setsar=1[spedv];
        [1:v]scale=${w}:${Math.floor(h / 3)}[bottombanner];
        [2:v]scale=${w}:${Math.floor(h / 3)}[topbanner];
        [spedv][bottombanner]overlay=0:${h - Math.floor(h / 3)}[withbottombanner];
        [withbottombanner][topbanner]overlay=0:0[finalv]
      `)
      //  .audioFilter('atempo=1.0') // Speed up the audio of the video clip
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-map', '[finalv]',
        '-map', '0:a?',
        '-pix_fmt', 'yuv420p',
        '-shortest'
      ])
      .on('end', () => resolve(resizedVideo))
      .on('error', reject)
      .save(resizedVideo);
  });
}

app.post('/upload', upload.array('media', 10), async (req, res) => {
  const title = req.body.title || '';
  const caption = req.body.caption || '';
  const orientation = req.body.orientation || 'portrait';
  const resolution = orientation === 'portrait' ? '1080x1920' : '1920x1080';
  const ts = Date.now();
  const tempDir = path.join(__dirname, 'temp');
  const finalVideoPath = path.join(__dirname, `output_${ts}.mp4`);
  const silentVideoPath = finalVideoPath.replace('.mp4', '_silent.mp4');
  const musicOption = req.body.music_option || 'default';


  // Initialize mediaFiles from req.files
  const mediaFiles = req.files || [];


  // Validate file uploads
  if (musicOption === 'ai') {
    const hasImages = mediaFiles.some(file => ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(file.originalname).toLowerCase()));
    if (!hasImages) {
      return res.status(400).send('At least one image file must be selected for AI audio.');
    }
  } else {
    if (mediaFiles.length === 0) {
      return res.status(400).send('At least one file must be selected.');
    }
  }

  fs.mkdirSync(tempDir, { recursive: true });

  if (musicOption === 'merge_only') {
    // Option 5: Merge Video Clips Only (no transformation)
    const videoClipPaths = [];
    for (let i = 0; i < mediaFiles.length; i++) {
      const file = mediaFiles[i];
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext !== '.mp4') continue;
      // Use absolute path for ffmpeg concat
      videoClipPaths.push(path.resolve(file.path));
    }

    if (videoClipPaths.length < 2) {
      return res.status(400).send('At least two video clips (.mp4) are required to merge.');
    }

    // If exactly two clips, use the Python script for robust merging
if (videoClipPaths.length === 2) {
  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoClipPaths[0])
      .input(videoClipPaths[1])
      .complexFilter('[0:v:0][0:a:0][1:v:0][1:a:0]concat=n=2:v=1:a=1[outv][outa]')
      .outputOptions([
        '-map', '[outv]',
        '-map', '[outa]',
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-y' // overwrite output
      ])
      .output(finalVideoPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}
 else {
// For more than 2 clips, re-encode and merge using concat filter
const inputOptions = [];
const filterInputs = [];
const outputMaps = [];

videoClipPaths.forEach((clipPath, i) => {
  inputOptions.push('-i', clipPath);
  filterInputs.push(`[${i}:v:0][${i}:a:0]`);
});

const filterComplex = `${filterInputs.join('')}concat=n=${videoClipPaths.length}:v=1:a=1[outv][outa]`;

await new Promise((resolve, reject) => {
  const ffmpegCmd = ffmpeg();

  videoClipPaths.forEach(p => ffmpegCmd.input(p));

  ffmpegCmd
    .complexFilter(filterComplex)
    .outputOptions([
      '-map', '[outv]',
      '-map', '[outa]',
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-y'
    ])
    .output(finalVideoPath)
    .on('end', resolve)
    .on('error', reject)
    .run();
});

    }
  } else if (musicOption === 'transform_merge') {
    // Option 3: Transform & Merge Video Clips Only
    const videoClipPaths = [];
    for (let i = 0; i < mediaFiles.length; i++) {
      const file = mediaFiles[i];
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext !== '.mp4') continue;
      const resizedVideo = await processVideoClip(file, tempDir, resolution, i);
      videoClipPaths.push(resizedVideo);
    }

    if (videoClipPaths.length > 0) {
      const finalConcatList = path.join(tempDir, 'final_concat.txt');
      fs.writeFileSync(finalConcatList, videoClipPaths.map(p => `file '${p}'`).join('\n'));
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(finalConcatList)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-c', 'copy', '-y'])
          .output(finalVideoPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
      fs.unlinkSync(finalConcatList);
    }
  } else if (musicOption === 'transform_add_music') {
    // Option 4: Transform & Merge Video Clips and Add Background Music
    const videoClipPaths = [];
    for (let i = 0; i < mediaFiles.length; i++) {
      const file = mediaFiles[i];
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext !== '.mp4') continue;
      const resizedVideo = await processVideoClip(file, tempDir, resolution, i);
      videoClipPaths.push(resizedVideo);
    }

    if (videoClipPaths.length > 0) {
      const finalConcatList = path.join(tempDir, 'final_concat.txt');
      const silentVideoPath = path.join(tempDir, `silent_video.mp4`);
      const audioPath = path.join(__dirname, 'assets/default-bg-music.mp3');

      // Concatenate video clips
      fs.writeFileSync(finalConcatList, videoClipPaths.map(p => `file '${p}'`).join('\n'));
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(finalConcatList)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y'])
          .output(silentVideoPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });

      // Get the duration of the concatenated video
      const videoDuration = await getAudioDuration(silentVideoPath);
      const audioDuration = await getAudioDuration(audioPath);

      // Calculate the number of loops needed for the background music
      const loopCount = Math.ceil(videoDuration / audioDuration) - 1;

      // Add background music with looping
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(silentVideoPath)
          .input(audioPath)
          .inputOptions(['-stream_loop', loopCount.toString()]) // Loop the audio
          .audioFilters('volume=0.5')
          .outputOptions([
            '-map', '0:v:0',
            '-map', '1:a:0',
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-shortest' // Ensure the output is as long as the video
          ])
          .output(finalVideoPath)
          .on('end', () => {
            fs.unlinkSync(silentVideoPath);
            resolve();
          })
          .on('error', reject)
          .run();
      });
      fs.unlinkSync(finalConcatList);
    }
  }
  else {
    // Existing logic for other options
    let audioPath, audioDuration, chunkDuration = 6, numberOfChunks, captionChunks = [], wordsPerChunk;

    if (musicOption === 'ai') {
      audioPath = path.join(tempDir, 'ai-bg-music.mp3');
      // Remove only *, _, - from the caption for AI audio
      const sanitizedCaption = caption.replace(/[\*_\-]/g, '');
      await generateAIAudio(sanitizedCaption, audioPath);
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
      // Only process images for AI audio
      const imageFiles = mediaFiles.filter(f => ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(f.originalname).toLowerCase()));
      mediaFiles.length = 0;
      imageFiles.forEach(f => mediaFiles.push(f));
    } else {
      // Default music: only use image files, ignore video clips
      audioPath = path.join(__dirname, 'assets/default-bg-music.mp3');
      // Filter only image files
      const imageFiles = mediaFiles.filter(f => ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(f.originalname).toLowerCase()));
      const numImages = imageFiles.length;
      // Use default chunking logic (18 words per chunk), but if more images than chunks, split caption into numImages chunks
      const words = caption.split(/\s+/).filter(Boolean);
      let numChunks, wordsPerChunk;
      if (numImages > 0) {
        // First, try 18 words per chunk
        wordsPerChunk = 18;
        for (let i = 0; i < words.length; i += wordsPerChunk) {
          captionChunks.push(words.slice(i, i + wordsPerChunk).join(' '));
        }
        numChunks = captionChunks.length;
        if (numImages > numChunks) {
          // More images than chunks, so split caption into numImages chunks
          captionChunks = [];
          wordsPerChunk = Math.ceil(words.length / numImages);
          for (let i = 0; i < words.length; i += wordsPerChunk) {
            captionChunks.push(words.slice(i, i + wordsPerChunk).join(' '));
          }
          numChunks = captionChunks.length;
        }
      } else {
        // No images, fallback to 18 words per chunk
        wordsPerChunk = 18;
        for (let i = 0; i < words.length; i += wordsPerChunk) {
          captionChunks.push(words.slice(i, i + wordsPerChunk).join(' '));
        }
        numChunks = captionChunks.length;
      }
      // Each image: 6s, each chunk: 6s
      const imagesDuration = numImages * chunkDuration;
      const chunksDuration = numChunks * chunkDuration;
      // The total video duration is the max of the two
      const totalDuration = Math.max(imagesDuration, chunksDuration);
      audioDuration = totalDuration;
      // Repeat images if needed to match chunk count, or trim if more images than chunks
      let repeatedImages = [];
      if (numImages === 0) {
        // No images, fallback to empty
        repeatedImages = [];
      } else if (numChunks >= numImages) {
        // Need to repeat images to match number of chunks
        for (let i = 0; i < numChunks; i++) {
          repeatedImages.push(imageFiles[i % numImages]);
        }
      } else {
        // More images than chunks, just use images up to numImages
        for (let i = 0; i < numImages; i++) {
          repeatedImages.push(imageFiles[i]);
        }
      }
      // Overwrite mediaFiles to only include repeated images for downstream processing
      mediaFiles.length = 0;
      repeatedImages.forEach(f => mediaFiles.push(f));
      // If music is shorter than totalDuration, it will be looped in ffmpeg step below
    }

    // Process images for caption chunks (for default and ai audio only)
    const processedMedia = [];
    const mediaCount = mediaFiles.length;

    for (let i = 0; i < captionChunks.length; i++) {
      let imgIdx = i % mediaCount;
      let file = mediaFiles[imgIdx];
      let ext = path.extname(file.originalname).toLowerCase();
      // Only process images (should always be true here)
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

    // Do not process video clips for default music and ai audio options
    const videoClipPaths = [];

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
  }

  // Cleanup old output files, uploads, and temp files older than 2 hours after response is sent
  res.on('finish', () => {
    try {
      const now = Date.now();
      const twoHoursMs = 2 * 60 * 60 * 1000;
      // Delete output_*.mp4 files older than 2 hours
      fs.readdirSync(__dirname).forEach(file => {
        if (file.startsWith('output_') && file.endsWith('.mp4')) {
          const filePath = path.join(__dirname, file);
          try {
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > twoHoursMs) {
              fs.unlinkSync(filePath);
            }
          } catch { }
        }
      });
      // Delete uploads older than 2 hours
      const uploadsDir = path.join(__dirname, 'uploads');
      if (fs.existsSync(uploadsDir)) {
        fs.readdirSync(uploadsDir).forEach(file => {
          const filePath = path.join(uploadsDir, file);
          try {
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > twoHoursMs) {
              fs.unlinkSync(filePath);
            }
          } catch { }
        });
      }
      // Delete temp files older than 2 hours
      const tempDirPath = path.join(__dirname, 'temp');
      if (fs.existsSync(tempDirPath)) {
        fs.readdirSync(tempDirPath).forEach(file => {
          const filePath = path.join(tempDirPath, file);
          try {
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > twoHoursMs) {
              fs.unlinkSync(filePath);
            }
          } catch { }
        });
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  res.render('result', { videoName: path.basename(finalVideoPath) });
});

app.get('/video/:name', (req, res) => {
  const videoPath = path.join(__dirname, req.params.name);
  if (fs.existsSync(videoPath)) res.sendFile(videoPath);
  else res.status(404).send('Video not found.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running at http://localhost:${PORT}`));
