const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, registerFont } = require('canvas');
const ffmpeg = require('fluent-ffmpeg');
const { exec } = require('child_process');
const app = express();
require('dotenv').config();

// Register the Telugu font
registerFont(path.join(__dirname, 'assets', 'default-telugu-font.ttf'), { family: 'TeluguFont' });

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
  limits: { files: 20 } // Increased limit from 10 to 20
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
async function mergeVideos(videoPaths, outputPath) {
  if (videoPaths.length === 2) {
    // Simple concat for 2 videos
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(videoPaths[0])
        .input(videoPaths[1])
        .complexFilter('[0:v:0][0:a:0][1:v:0][1:a:0]concat=n=2:v=1:a=1[outv][outa]')
        .outputOptions([
          '-map', '[outv]',
          '-map', '[outa]',
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-y'
        ])
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
  } else if (videoPaths.length > 2) {
    // Recursive chaining for more than 2 videos
    let currentVideos = [...videoPaths];
    let tempOutputIndex = 0;

    while (currentVideos.length > 1) {
      const nextRound = [];

      for (let i = 0; i < currentVideos.length; i += 2) {
        if (i + 1 >= currentVideos.length) {
          nextRound.push(currentVideos[i]); // Odd one out, push as-is
        } else {
          const tempOutput = path.join(__dirname, `temp_merge_${Date.now()}_${tempOutputIndex++}.mp4`);
          await mergeVideos([currentVideos[i], currentVideos[i + 1]], tempOutput);
          nextRound.push(tempOutput);
        }
      }

      currentVideos = nextRound;
    }

    // Rename the final output
    fs.renameSync(currentVideos[0], outputPath);
  } else {
    throw new Error('At least two video clips required to merge.');
  }
}

// Function to generate AI audio using Python script
function generateAIAudio(text, outputPath) {
  return new Promise((resolve, reject) => {
    let command;

    if (process.env.NODE_ENV === 'production') {
      command = `/home/quizchampindia-shorts/htdocs/shorts.quizchampindia.in/bin/python generate_audio.py "${text}" "${outputPath}"`;
    } else {
      command = `python generate_audio.py "${text}" "${outputPath}"`;
    }

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error generating AI audio: ${error}`);
        reject(error);
      } else {
        console.log(`AI audio generated successfully: ${stdout}`);
        resolve(outputPath);
      }
    });
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

app.post('/upload', upload.array('media', 20), async (req, res) => {
  const title = (req.body.title || '').trim();
  const caption = req.body.caption || '';
  const orientation = req.body.orientation || 'portrait';
  const resolution = orientation === 'portrait' ? '1080x1920' : '1920x1080';
  const ts = Date.now();
  // Prepend sanitized title to output file name
  const sanitizedTitle = title.replace(/[^a-zA-Z0-9_\-]/g, '_').substring(0, 32);
  const outputsDir = path.join(__dirname, 'outputs');
  fs.mkdirSync(outputsDir, { recursive: true });
  const finalVideoPath = path.join(outputsDir, `${sanitizedTitle}_output_${ts}.mp4`);
  const silentVideoPath = finalVideoPath.replace('.mp4', '_silent.mp4');
  const musicOption = req.body.music_option || 'default';
  const tempDir = path.join(__dirname, 'temp');

  // Initialize mediaFiles from req.files
  const mediaFiles = req.files || [];

  // Validate file uploads
  if (musicOption === 'ai') {
    const hasImages = mediaFiles.some(file => ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(file.originalname).toLowerCase()));
    if (!title) {
      return res.status(400).render('error', {
        error: 'Video Title is required.',
        errorTelugu: 'వీడియో శీర్షిక తప్పనిసరిగా ఇవ్వాలి.'
      });
    }
    if (!hasImages) {
      return res.status(400).render('error', {
        error: 'At least one image file must be selected for AI audio.',
        errorTelugu: 'AI ఆడియో కోసం కనీసం ఒక చిత్రం ఫైల్ ఎంపిక చేయాలి.'
      });
    }
  } else {
    if (!title) {
      return res.status(400).render('error', {
        error: 'Video Title is required.',
        errorTelugu: 'వీడియో శీర్షిక తప్పనిసరిగా ఇవ్వాలి.'
      });
    }
    if (mediaFiles.length === 0) {
      return res.status(400).render('error', {
        error: 'At least one file must be selected.',
        errorTelugu: 'కనీసం ఒక ఫైల్ ఎంపిక చేయాలి.'
      });
    }
  }

  fs.mkdirSync(tempDir, { recursive: true });

  if (musicOption === 'merge_only') {
    // Option 5: Merge Video Clips Only (no transformation)
    const videoClipPaths = [];
    const orientations = [];
    const resolutions = [];
    for (let i = 0; i < mediaFiles.length; i++) {
      const file = mediaFiles[i];
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext !== '.mp4') continue;
      // Use absolute path for ffmpeg concat
      const absPath = path.resolve(file.path);

      // Get orientation and resolution for each video
      let isPortrait = false;
      let width = 0, height = 0;
      try {
        const metadata = await new Promise((resolve, reject) => {
          ffmpeg.ffprobe(file.path, (err, data) => {
            if (err) reject(err);
            else resolve(data);
          });
        });
        const stream = metadata.streams.find(s => s.codec_type === 'video');
        if (stream && stream.width && stream.height) {
          width = stream.width;
          height = stream.height;
          isPortrait = height > width;
          resolutions.push(`${width}x${height}`);
        }
      } catch (e) {
        // If ffprobe fails, fallback to landscape
        isPortrait = false;
        resolutions.push('unknown');
      }
      orientations.push(isPortrait ? 'portrait' : 'landscape');
      videoClipPaths.push(absPath);
    }

    if (videoClipPaths.length < 2) {
      return res.status(400).render('error', {
        error: 'At least two video clips (.mp4) are required to merge.',
        errorTelugu: 'మిళితం చేయడానికి కనీసం రెండు వీడియో క్లిప్స్ (.mp4) అవసరం.'
      });
    }

    // Check if all orientations are the same
    const allPortrait = orientations.every(o => o === 'portrait');
    const allLandscape = orientations.every(o => o === 'landscape');
    if (!(allPortrait || allLandscape)) {
      return res.status(400).render('error', {
        error: 'All input videos must have the same orientation (all portrait or all landscape).',
        errorTelugu: 'అన్ని వీడియోలు ఒకే రకమైన దిశలో ఉండాలి (అన్నీ portrait లేదా అన్నీ landscape).'
      });
    }

    // Re-encode all videos to matching resolution if needed
    let reencodedPaths = [];
    if (allPortrait) {
      // Portrait: re-encode all to 1080x1920
      for (let i = 0; i < videoClipPaths.length; i++) {
        const inputPath = videoClipPaths[i];
        const outputPath = path.join(tempDir, `portrait_reencoded_${i}.mp4`);
        await new Promise((resolve, reject) => {
          ffmpeg()
            .input(inputPath)
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions(['-vf', 'scale=1080:1920', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-y'])
            .output(outputPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        });
        reencodedPaths.push(outputPath);
      }
    } else if (allLandscape) {
      // Landscape: re-encode all to 1920x1080
      for (let i = 0; i < videoClipPaths.length; i++) {
        const inputPath = videoClipPaths[i];
        const outputPath = path.join(tempDir, `landscape_reencoded_${i}.mp4`);
        await new Promise((resolve, reject) => {
          ffmpeg()
            .input(inputPath)
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions(['-vf', 'scale=1920:1080', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-y'])
            .output(outputPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        });
        reencodedPaths.push(outputPath);
      }
    }

    // Merge re-encoded videos
    if (reencodedPaths.length === 2) {
      await mergeVideos(reencodedPaths, finalVideoPath);
    } else if (reencodedPaths.length > 2) {
      await mergeVideos(reencodedPaths, finalVideoPath);
    }
  } else if (musicOption === 'transform_merge') {
    // Option 3: Transform & Merge Video Clips Only
    const videoClipPaths = [];
    let portraitCount = 0;
    let lastPortraitPath = null;
    for (let i = 0; i < mediaFiles.length; i++) {
      const file = mediaFiles[i];
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext !== '.mp4') continue;

      // Check video orientation if required
      let isPortrait = false;
      try {
        const metadata = await new Promise((resolve, reject) => {
          ffmpeg.ffprobe(file.path, (err, data) => {
            if (err) reject(err);
            else resolve(data);
          });
        });
        const stream = metadata.streams.find(s => s.codec_type === 'video');
        if (stream && stream.width && stream.height) {
          isPortrait = stream.height > stream.width;
        }
      } catch (e) {
        // If ffprobe fails, fallback to transformation
        isPortrait = false;
      }

      if (orientation === 'portrait' && isPortrait) {
        portraitCount++;
        lastPortraitPath = file.path;
        // Re-encode portrait video to 1080x1920 before merging
        const reencodedPath = path.join(tempDir, `portrait_reencoded_${i}.mp4`);
        await new Promise((resolve, reject) => {
          ffmpeg()
            .input(file.path)
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions(['-vf', 'scale=1080:1920', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-y'])
            .output(reencodedPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        });
        videoClipPaths.push(reencodedPath);
      } else {
        // Otherwise, apply transformation
        const resizedVideo = await processVideoClip(file, tempDir, resolution, i);
        videoClipPaths.push(resizedVideo);
      }
    }

    // If only one video and it's portrait, just re-encode to 1080x1920 and output, retain original audio
    if (videoClipPaths.length === 1 && portraitCount === 1 && orientation === 'portrait') {
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(lastPortraitPath)
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions(['-vf', 'scale=1080:1920', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-y'])
          .output(finalVideoPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
    } else if (videoClipPaths.length > 0) {
      await mergeVideos(videoClipPaths, finalVideoPath);
    }
  } else if (musicOption === 'transform_add_music') {
    // Option 4: Transform & Merge Video Clips and Add Background Music
    const portraitVideos = [];
    const transformedVideos = [];
    let portraitFlags = [];
    for (let i = 0; i < mediaFiles.length; i++) {
      const file = mediaFiles[i];
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext !== '.mp4') continue;

      // Check video orientation
      let isPortrait = false;
      try {
        const metadata = await new Promise((resolve, reject) => {
          ffmpeg.ffprobe(file.path, (err, data) => {
            if (err) reject(err);
            else resolve(data);
          });
        });
        const stream = metadata.streams.find(s => s.codec_type === 'video');
        if (stream && stream.width && stream.height) {
          isPortrait = stream.height > stream.width;
        }
      } catch (e) {
        isPortrait = false;
      }
      portraitFlags.push(isPortrait);

      if (isPortrait) {
        // Skip transformation, but include for merging
        portraitVideos.push(file.path);
      } else {
        // Transform landscape videos
        const resizedVideo = await processVideoClip(file, tempDir, resolution, i);
        transformedVideos.push(resizedVideo);
      }
    }

    // Always re-encode portrait videos to standard format before merging
    let reencodedPortraits = [];
    if (portraitVideos.length > 0) {
      for (let i = 0; i < portraitVideos.length; i++) {
        const inputPath = portraitVideos[i];
        const outputPath = path.join(tempDir, `portrait_reencoded_${i}.mp4`);
        await new Promise((resolve, reject) => {
          ffmpeg()
            .input(inputPath)
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions(['-vf', 'scale=1080:1920', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-y'])
            .on('end', resolve)
            .on('error', reject)
            .save(outputPath);
        });
        reencodedPortraits.push(outputPath);
      }
    }
    let allVideosToMerge;
    if (portraitVideos.length > 0 && transformedVideos.length === 0 && portraitFlags.every(f => f)) {
      // All portrait, use re-encoded only
      allVideosToMerge = reencodedPortraits;
    } else {
      // Mix of landscape and portrait
      allVideosToMerge = [...transformedVideos, ...reencodedPortraits];
    }

    if (!allVideosToMerge || allVideosToMerge.length === 0) {
      return res.status(400).render('error', {
        error: 'No valid video clips (.mp4) found for merging and adding music.',
        errorTelugu: 'మ్యూజిక్ జోడించడానికి మరియు మిళితం చేయడానికి సరైన వీడియో క్లిప్స్ (.mp4) కనుగొనబడలేదు.'
      });
    }

    // Create concat list
    const finalConcatList = path.join(tempDir, 'final_concat.txt');
    fs.writeFileSync(finalConcatList, allVideosToMerge.map(p => `file '${p}'`).join('\n'));

    // Check concat file
    let concatStats;
    try {
      concatStats = fs.statSync(finalConcatList);
    } catch (e) {
      return res.status(400).render('error', {
        error: 'Internal error: concat list file not created.',
        errorTelugu: 'అంతర్గత లోపం: concat లిస్ట్ ఫైల్ సృష్టించబడలేదు.'
      });
    }
    if (!concatStats || concatStats.size === 0) {
      return res.status(400).render('error', {
        error: 'No valid video clips (.mp4) found for merging and adding music.',
        errorTelugu: 'మ్యూజిక్ జోడించడానికి మరియు మిళితం చేయడానికి సరైన వీడియో క్లిప్స్ (.mp4) కనుగొనబడలేదు.'
      });
    }

    // Merge videos
    const silentVideoPath = path.join(tempDir, `silent_video.mp4`);
    const audioPath = path.join(__dirname, 'assets/default-bg-music.mp3');
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

    // Add background music
    const videoDuration = await getAudioDuration(silentVideoPath);
    const audioDuration = await getAudioDuration(audioPath);
    const loopCount = Math.ceil(videoDuration / audioDuration) - 1;
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(silentVideoPath)
        .input(audioPath)
        .inputOptions(['-stream_loop', loopCount.toString()])
        .audioFilters('volume=0.5')
        .outputOptions([
          '-map', '0:v:0',
          '-map', '1:a:0',
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-shortest'
        ])
        .output(finalVideoPath)
        .on('end', () => {
          fs.unlinkSync(silentVideoPath);
          resolve();
        })
        .on('error', reject)
        .run();
    });
  }
  else {
    // Existing logic for other options
    let audioPath, audioDuration, chunkDuration = 6, numberOfChunks, captionChunks = [], wordsPerChunk;

    if (musicOption === 'ai') {
      audioPath = path.join(tempDir, 'ai-bg-music.mp3');
      // Remove only *, _, - from the caption for AI audio
      const sanitizedCaption = caption.replace(/[\*_\-\"]/g, '');
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
      let imgIdx = i % mediaFiles.length;
      let file = mediaFiles[imgIdx];
      let ext = path.extname(file.originalname).toLowerCase();
      // Only process images (should always be true here)
      if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) continue;

      const baseOutput = path.join(tempDir, `frame_${i}.png`);
      const videoOutput = path.join(tempDir, `clip_${i}.mp4`);
      const thisCaption = captionChunks[i];
      const [outW, outH] = resolution.split('x').map(Number);
      const img = await loadImage(file.path);
      const canvas = createCanvas(outW, outH);
      const ctx = canvas.getContext('2d');

      // Detect portrait image
      const isPortraitImg = img.height > img.width;

      if (orientation === 'landscape' && !isPortraitImg) {
        // Landscape mode: ignore portrait images

        // Fill background
        ctx.fillStyle = '#2d5072';
        ctx.fillRect(0, 0, outW, outH);

        // Calculate 4/5 width and height
        const imgW = Math.floor(outW * 0.8);
        const imgH = Math.floor(outH * 0.8);

        // Draw image in top-left 4/5 area
        ctx.drawImage(img, 0, 0, imgW, imgH);

        // Draw vertical banner in rightmost 1/5 width
        const bannerPath = path.join(__dirname, 'assets/right-adv-banner.jpeg');
        try {
          const bannerImg = await loadImage(bannerPath);
          ctx.drawImage(bannerImg, outW - Math.floor(outW * 0.2), 0, Math.floor(outW * 0.2), outH);
        } catch { }

        // Draw caption text in bottom 1/5 height, left 4/5 width
        if (thisCaption) {
          ctx.save();
          ctx.font = `bold ${Math.floor(outH / 20)}px TeluguFont`;
          ctx.fillStyle = 'white';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          // Text area: bottom 1/5 height, left 4/5 width
          const textAreaW = Math.floor(outW * 0.8);
          const textAreaH = Math.floor(outH * 0.2);
          const textAreaX = textAreaW / 2;
          const textAreaY = outH - textAreaH / 2;

          // Wrap text if needed
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

          const lines = wrapTextLines(thisCaption, textAreaW * 0.95, 3);
          for (let l = 0; l < lines.length; l++) {
            ctx.fillText(
              lines[l],
              textAreaX,
              textAreaY + (l - (lines.length - 1) / 2) * Math.floor(outH / 20) * 1.2
            );
          }
          ctx.restore();
        }
      } else if (orientation === 'portrait' && isPortraitImg && (musicOption === 'default' || musicOption === 'ai')) {
        // Portrait image: watermark and logo only (existing logic)
        ctx.drawImage(img, 0, 0, outW, outH);
        ctx.save();
        ctx.font = `bold ${Math.floor(outH / 28)}px TeluguFont`;
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('SPP NEWS CHIPURUPALLI', Math.floor(outW * 0.05), Math.floor(outH / 2));
        ctx.restore();
        const logoPath = path.join(__dirname, 'assets/transparent.png');
        try {
          const logoImg = await loadImage(logoPath);
          const logoW = Math.floor(outW / 6);
          const logoH = Math.floor(logoW * (logoImg.height / logoImg.width));
          ctx.drawImage(logoImg, outW - logoW - 10, 10, logoW, logoH);
        } catch { }
      } else {
        // Existing landscape transformation for other cases (if any)
        // ...your previous code...
      }

      // Save PNG and convert to video as before
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
    let videoForAudio = silentVideoPath;
    // Concatenate video clips if any
    if (videoClipPaths.length > 0) {
      const finalConcatList = path.join(tempDir, 'final_concat.txt');
      const allVideos = [silentVideoPath, ...videoClipPaths];
      fs.writeFileSync(finalConcatList, allVideos.map(p => `file '${p}'`).join('\n'));
      const finalOutputPath = finalVideoPath.replace('.mp4', '_withclips.mp4');

      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(finalConcatList)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-c:v', 'libx264', '-c:a', 'aac', '-y'])
          .output(finalOutputPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });

      videoForAudio = finalOutputPath;
      //fs.unlinkSync(finalConcatList);
    }

    // Now add/overlay audio to the merged video
    await new Promise((resolve, reject) => {
      const ff = ffmpeg().input(videoForAudio);
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
          // Clean up temp files
          try { fs.unlinkSync(silentVideoPath); } catch { }
          if (videoForAudio !== silentVideoPath) {
            try { fs.unlinkSync(videoForAudio); } catch { }
          }
          resolve();
        })
        .on('error', reject)
        .run();
    });
  }

  // Cleanup old output files, uploads, and temp files older than 2 hours after response is sent
  res.on('finish', () => {
    try {
      const now = Date.now();
      const twoHoursMs = 2 * 60 * 60 * 1000;
      // Delete output files older than 2 hours in outputs folder
      const outputsDir = path.join(__dirname, 'outputs');
      if (fs.existsSync(outputsDir)) {
        fs.readdirSync(outputsDir).forEach(file => {
          const filePath = path.join(outputsDir, file);
          try {
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > twoHoursMs) {
              fs.unlinkSync(filePath);
            }
          } catch { }
        });
      }
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
  const videoPath = path.join(__dirname, 'outputs', req.params.name);
  if (fs.existsSync(videoPath)) res.sendFile(videoPath);
  else res.status(404).send('Video not found.');
});

const PORT = process.env.PORT || 50516;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running at http://localhost:${PORT}`));
