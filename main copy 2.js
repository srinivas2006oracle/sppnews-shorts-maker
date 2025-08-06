const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');
const ffmpeg = require('fluent-ffmpeg');
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

app.post('/upload', upload.array('media', 10), async (req, res) => {
  const caption = req.body.caption || '';
  const orientation = req.body.orientation || 'portrait';
  const resolution = orientation === 'portrait' ? '1080x1920' : '1920x1080';
  const ts = Date.now();
  const tempDir = path.join(__dirname, 'temp');
  const archiveDir = path.join(__dirname, 'archive', ts.toString());
  const finalVideoPath = path.join(__dirname, `output_${ts}.mp4`);
  const silentVideoPath = finalVideoPath.replace('.mp4', '_silent.mp4');
  const audioPath = path.join(__dirname, 'assets/default-bg-music.mp3');

  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });

  const words = caption.split(/\s+/).filter(Boolean);
  const chunkSize = 18;
  const captionChunks = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    captionChunks.push(words.slice(i, i + chunkSize).join(' '));
  }

  const mediaFiles = req.files;
  const processedMedia = [];
  const mediaCount = mediaFiles.length;

  // First, process only images for caption chunks
  for (let i = 0; i < captionChunks.length; i++) {
    // Find the next image file in round-robin order
    let imgIdx = i % mediaCount;
    let file = mediaFiles[imgIdx];
    let ext = path.extname(file.originalname).toLowerCase();
    // If not an image, skip to next image
    let tries = 0;
    while (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext) && tries < mediaCount) {
      imgIdx = (imgIdx + 1) % mediaCount;
      file = mediaFiles[imgIdx];
      ext = path.extname(file.originalname).toLowerCase();
      tries++;
    }
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) continue; // skip if no images at all
    const baseOutput = path.join(tempDir, `frame_${i}.png`);
    const videoOutput = path.join(tempDir, `clip_${i}.mp4`);
    const thisCaption = captionChunks[i];
    const [outW, outH] = resolution.split('x').map(Number);

    const bannerPath = path.join(__dirname, 'assets/shorts-bottom-banner.png');
    const bannerImg = await loadImage(bannerPath);
    const img = await loadImage(file.path);
    const canvas = createCanvas(outW, outH);
    const ctx = canvas.getContext('2d');

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

    await imageToSilentVideoWithFade(baseOutput, videoOutput, 6, resolution);
    processedMedia.push(videoOutput);
  }


  // Now, append all video clips (resized, no overlays/captions) after the main captioned video
  const videoClipPaths = [];
  for (let i = 0; i < mediaFiles.length; i++) {
    const file = mediaFiles[i];
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.mp4') continue;
    const [w, h] = resolution.split('x').map(Number);
    const resizedVideo = path.join(tempDir, `video_append_${i}.mp4`);
    const bottomBannerPath = path.join(__dirname, 'assets/shorts-bottom-banner.png');
    const topBannerPath = path.join(__dirname, 'assets/shorts-top-banner.png');
    // Overlay both top and bottom banners
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(file.path)
        .input(bottomBannerPath)
        .input(topBannerPath)
        .complexFilter([
          // [0:v] = video, [1:v] = bottom banner, [2:v] = top banner
          {
            filter: 'scale',
            options: { w: w, h: h, force_original_aspect_ratio: 'decrease' },
            inputs: '[0:v]',
            outputs: 'scaledv'
          },
          {
            filter: 'pad',
            options: { w: w, h: h, x: '(ow-iw)/2', y: '(oh-ih)/2', color: '#2d5072' },
            inputs: 'scaledv',
            outputs: 'paddedv'
          },
          {
            filter: 'setsar',
            options: { r: 1 },
            inputs: 'paddedv',
            outputs: 'sarv'
          },
          {
            filter: 'setpts',
            options: 'PTS/1',
            inputs: 'sarv',
            outputs: 'spedv'
          },
          // Bottom banner
          {
            filter: 'scale',
            options: { w: w, h: Math.floor(h / 3) },
            inputs: '[1:v]',
            outputs: 'bottombanner'
          },
          // Top banner
          {
            filter: 'scale',
            options: { w: w, h: Math.floor(h / 3) },
            inputs: '[2:v]',
            outputs: 'topbanner'
          },
          // Overlay bottom banner
          {
            filter: 'overlay',
            options: { x: 0, y: h - Math.floor(h / 3) },
            inputs: ['spedv', 'bottombanner'],
            outputs: 'withbottombanner'
          },
          // Overlay top banner
          {
            filter: 'overlay',
            options: { x: 0, y: 0 },
            inputs: ['withbottombanner', 'topbanner'],
            outputs: 'finalv'
          }
        ], 'finalv')
        .videoCodec('libx264')
        .audioCodec('aac')
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          '-pix_fmt yuv420p',
          '-shortest',
          '-map 0:v:0',
          '-map 0:a?',
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

  const totalDuration = captionChunks.length * 6; // 6 sec per clip
  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(silentVideoPath)
      .input(audioPath)
      .inputOptions(['-stream_loop', '-1']) // loop audio
      .audioFilters('volume=0.5')
      .outputOptions([
        '-map 0:v:0',
        '-map 1:a:0',
        '-c:v copy',
        '-c:a aac',
        `-t ${totalDuration}`
      ])
      .output(finalVideoPath)
      .on('end', () => {
        fs.unlinkSync(silentVideoPath);
        resolve();
      })
      .on('error', reject)
      .run();
  });

  // If there are video clips, concatenate them after the main video
  if (videoClipPaths.length > 0) {
    const finalConcatList = path.join(tempDir, 'final_concat.txt');
    // Main video first, then all video clips
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
    // Replace finalVideoPath with the new output
    fs.renameSync(finalOutputPath, finalVideoPath);
    fs.unlinkSync(finalConcatList);
  }

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
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
