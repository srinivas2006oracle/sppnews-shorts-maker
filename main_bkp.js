const express = require('express')
const multer = require('multer')
const fs = require('fs')
const path = require('path')
const { createCanvas, loadImage } = require('canvas')
const ffmpeg = require('fluent-ffmpeg')

const app = express()

app.use(express.urlencoded({ extended: true }))
app.use(express.static('public'))

const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.mp4']
const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, allowedExts.includes(ext))
  },
  limits: { files: 10 }
})

// Mobile-friendly HTML form
app.get('/', (req, res) => {
  res.send(`
    <html>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <body style="font-family:sans-serif;max-width:400px;margin:auto;">
        <h2>Image to Video (Mobile)</h2>
        <form id="videoForm" action="/upload" method="post" enctype="multipart/form-data">
          <label>Video Orientation:<br>
            <select name="orientation" required>
              <option value="landscape">Landscape</option>
              <option value="portrait" selected>Portrait</option>
            </select>
          </label><br><br>
          <label for="w3review">Caption Text:</label>

<textarea id="w3review" name="caption" rows="20" cols="50">
చీపురుపల్లి నియోజకవర్గంలో 
అన్ని ప్రాంతాలకు సాగునీరు

#తోటపల్లి ప్రాజెక్టు అధికారులకు 
ఎమ్మెల్యే కళావెంకటరావు ఆదేశాలు 

రాజాం: చీపురుపల్లి నియోజకవర్గంతో పాటు నెల్లిమర్ల, ఎచ్చెర్ల నియోజకవర్గాల్లో ఉన్న చివరి సాగు భూమి వరకు తోటపల్లి ప్రాజెక్టుద్వారా సాగునీటిని అందించాలని శాసన సభ్యులు కిమిడి కళావెంకట రావు అధికారులను ఆదేశించారు.
రైతులు వరి నాట్లు వేసేందుకు సిద్ధంగా ఉన్నారని సాగునీరు తక్షణమే అందించాలని సూచించారు. ఈమేరకు బుధవారం  నాడు రాజాం తన క్యాంపు కార్యాలయంలో తోటపల్లి నీటిపారుదల అధికారులతో సమీక్షా సమావేశం నిర్వహించారు. నాగావళి నదిపై ప్రాజెక్ట్ ను నిర్మించే ఆశయాలు ఎన్నో ఏళ్లగా నిలిచేపోయిందని ప్రాజెక్ట్ నిర్మాణం జరిపి తీరాలానే దీక్షతో ముఖ్య మంత్రి చంద్రబాబు బాబు నాయుడు చేతుల మీదుగా ప్రారంభం జరిగిందని గుర్తు చేశారు. అదేవిధంగా మద్దువలస ప్రాజెక్టు కూడా నిర్మించి చంద్ర బాబు ప్రారంభం చేశారని చెప్పారు. దీంతో శ్రీకాకుళం, విజయనగరం జిల్లా్లో సాగునీరు లభించి రైతులు సంతోషకరంగా ఉన్నారని చెప్పారు. అయితే సమయానికి సాగునీటిని అందించవలసిన బాధ్యత అధికారులపై ఉందని గుర్తుచేశారు. ఈ మేరకు విజయనగరం జిల్లా కలెక్టర్ తోనూ, తోటపల్లి సూపరెంటెండెంట్ తోనూ మాట్లాడారు. 
సాగునీరు హృదాకాకుండా చూసేందుకు అవసరమైన లస్కర్లను నియమించాలని అధికారులకు సూచించారు. 
నెల్లిమర్ల నియోజకవర్గం సాగు భూములకు వచ్చేనెలలో సాగునీటిని అందించాలని కోరారు.  
ఈ కార్యక్రమంలో  తోటపల్లి ఈ ఈ అప్పలనాయుడు డిఈ లు మీసాల హరికృష్ణ నాయుడు, కె. సుచిత్రి, డి. ఉషారాణి తదితరులు పాల్గొన్నారు.</textarea>

          <label>Select Images or Videos (2-10):<br>
            <input type="file" name="media" accept="image/jpeg,image/png,image/webp,video/mp4" multiple required>
          </label><br><br>
          <button type="submit">Create Video</button>
        </form>
      </body>
    </html>
  `)
})

// Image to video with fade and default audio
function imageToVideoWithFadeAndAudio(inputPath, outputPath, duration = 6, resolution = '1080x1920', audioPath) {
  return new Promise((resolve, reject) => {
    const tempVideo = outputPath.replace('.mp4', '_silent.mp4')
    // Step 1: create silent video from image
    ffmpeg()
      .input(inputPath)
      .loop()
      .duration(duration)
      .videoCodec('libx264')
      .outputOptions([
        `-vf scale=${resolution},format=yuv420p,fade=t=in:st=0:d=1,fade=t=out:st=${duration - 1}:d=1`,
        '-r 30',
        '-pix_fmt yuv420p'
      ])
      .on('end', () => {
        // Step 2: add default audio only, trimmed to duration, with volume reduced by 50%
        ffmpeg()
          .input(tempVideo)
          .input(audioPath)
          .audioFilters('volume=0.5')
          .outputOptions([
            '-map 0:v:0',
            '-map 1:a:0',
            '-shortest',
            '-c:v copy',
            '-c:a aac',
            `-t ${duration}`
          ])
          .on('end', () => {
            fs.unlinkSync(tempVideo)
            resolve()
          })
          .on('error', reject)
          .save(outputPath)
      })
      .on('error', reject)
      .save(tempVideo)
  })
}

// Upload endpoint
app.post('/upload', upload.array('media', 10), async (req, res) => {
  const caption = req.body.caption || ''
  const orientation = req.body.orientation || 'portrait'
  const resolution = orientation === 'portrait' ? '1080x1920' : '1920x1080'

  const ts = Date.now()
  const tempDir = path.join(__dirname, 'temp')
  const archiveDir = path.join(__dirname, 'archive', ts.toString())
  const videoPath = path.join(__dirname, `output_${ts}.mp4`)

  fs.mkdirSync(tempDir, { recursive: true })
  fs.mkdirSync(archiveDir, { recursive: true })

  const processedMedia = []

  // --- Caption chunking and media repeat logic ---
  // Split caption into 10-word chunks
  const words = caption.split(/\s+/).filter(Boolean)
  const chunkSize = 10
  const captionChunks = []
  for (let i = 0; i < words.length; i += chunkSize) {
    captionChunks.push(words.slice(i, i + chunkSize).join(' '))
  }
  // Repeat media as needed to cover all caption chunks
  const mediaFiles = req.files
  const totalFrames = captionChunks.length
  const mediaCount = mediaFiles.length
  for (let i = 0; i < totalFrames; i++) {
    const file = mediaFiles[i % mediaCount]
    const ext = path.extname(file.originalname).toLowerCase()
    const baseOutput = path.join(tempDir, `frame_${i}.png`)
    const videoOutput = path.join(tempDir, `clip_${i}.mp4`)
    const thisCaption = captionChunks[i]
    if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      const [outW, outH] = resolution.split('x').map(Number)
      if (orientation === 'portrait') {
        // Portrait: top 1/3 text, middle 1/3 image, bottom 1/3 banner
        const bannerPath = path.join(__dirname, 'assets/shorts-bottom-banner.png')
        const bannerImg = await loadImage(bannerPath)
        const img = await loadImage(file.path)
        const canvas = createCanvas(outW, outH)
        const ctx = canvas.getContext('2d')
        // Dark cement blue background
        ctx.fillStyle = '#2d5072'
        ctx.fillRect(0, 0, outW, outH)
        // Top 1/3: caption
        const topH = Math.floor(outH / 3)
        ctx.fillStyle = 'rgba(43, 84, 111, 0.92)'
        ctx.fillRect(0, 0, outW, topH)
        // Word-wrap caption in 4 rows, font size reduced by another 70% (total 49% of original)
        const fontSize = Math.floor((topH / 4.2) * 0.7 * 0.7)
        ctx.font = `bold ${fontSize}px Arial`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = 'white'
        // Split caption into 4 lines
        function wrapTextLines(text, maxWidth, maxLines) {
          const words = text.split(/\s+/)
          const lines = []
          let line = ''
          for (let i = 0; i < words.length; i++) {
            const testLine = line ? line + ' ' + words[i] : words[i]
            const metrics = ctx.measureText(testLine)
            if (metrics.width > maxWidth && line) {
              lines.push(line)
              line = words[i]
              if (lines.length === maxLines - 1) break
            } else {
              line = testLine
            }
          }
          if (line && lines.length < maxLines) lines.push(line)
          // If still words left, append to last line
          if (lines.length < maxLines && words.length > 0) {
            let rest = words.slice(lines.join(' ').split(/\s+/).length).join(' ')
            if (rest) lines[lines.length-1] += ' ' + rest
          }
          return lines
        }
        const lines = wrapTextLines(thisCaption, outW * 0.95, 4)
        for (let l = 0; l < lines.length; l++) {
          ctx.fillText(lines[l], outW / 2, topH / 2 + (l - (lines.length-1)/2) * fontSize * 1.1)
        }
        // Middle 1/3: image (fit inside, do not stretch to fill)
        const midY = topH
        const midH = Math.floor(outH / 3)
        // Fit image to middle region (contain, no stretch)
        const imgRatio = img.width / img.height
        const midRatio = outW / midH
        let drawW, drawH
        if (imgRatio > midRatio) {
          drawW = outW
          drawH = outW / imgRatio
        } else {
          drawH = midH
          drawW = midH * imgRatio
        }
        ctx.drawImage(img, (outW - drawW) / 2, midY + (midH - drawH) / 2, drawW, drawH)
        // Bottom 1/3: banner
        const bannerH = outH - (topH + midH)
        ctx.drawImage(bannerImg, 0, outH - bannerH, outW, bannerH)
        // Save image and convert to video with default audio
        const out = fs.createWriteStream(baseOutput)
        await new Promise((resolve, reject) => {
          const stream = canvas.createPNGStream()
          stream.pipe(out)
          out.on('finish', resolve)
          out.on('error', reject)
        })
        await imageToVideoWithFadeAndAudio(baseOutput, videoOutput, 6, resolution, path.join(__dirname, 'assets/default-bg-music.mp3'))
        processedMedia.push(videoOutput)
      } else {
        // Landscape (existing logic)
        const img = await loadImage(file.path)
        const canvas = createCanvas(outW, outH)
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = 'black'
        ctx.fillRect(0, 0, outW, outH)
        // Fit image to output resolution (cover)
        const imgRatio = img.width / img.height
        const outRatio = outW / outH
        let drawW, drawH
        if (imgRatio > outRatio) {
          drawH = outH
          drawW = img.width * (outH / img.height)
        } else {
          drawW = outW
          drawH = img.height * (outW / img.width)
        }
        ctx.drawImage(img, (outW - drawW) / 2, (outH - drawH) / 2, drawW, drawH)
        // Caption
        const fontSize = Math.floor(outH * 0.06)
        const textHeight = fontSize + 16
        ctx.fillStyle = 'rgba(0,0,0,0.7)'
        ctx.fillRect(0, outH - textHeight, outW, textHeight)
        ctx.font = `bold ${fontSize}px Arial`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = 'white'
        ctx.fillText(thisCaption, outW / 2, outH - textHeight / 2)
        // Save image and convert to video with default audio
        const out = fs.createWriteStream(baseOutput)
        await new Promise((resolve, reject) => {
          const stream = canvas.createPNGStream()
          stream.pipe(out)
          out.on('finish', resolve)
          out.on('error', reject)
        })
        await imageToVideoWithFadeAndAudio(baseOutput, videoOutput, 6, resolution, path.join(__dirname, 'assets/default-bg-music.mp3'))
        processedMedia.push(videoOutput)
      }
    } else if (ext === '.mp4') {
      // Re-encode and resize video, retain audio
      const resizedVideo = path.join(tempDir, `video_${i}.mp4`)
      const [w, h] = resolution.split('x').map(Number)
      await new Promise((resolve, reject) => {
        ffmpeg(file.path)
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions([
            `-vf scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
            '-pix_fmt yuv420p'
          ])
          .on('end', resolve)
          .on('error', reject)
          .save(resizedVideo)
      })
      processedMedia.push(resizedVideo)
    }
    // Do not move files here; move all originals after rendering is complete
  // end for loop
  // --- End caption chunking/media repeat logic ---
  // (rest of code continues)

    // (archive already handled above for each file only once)
  }

  // Build concat list
  const concatListPath = path.join(tempDir, `concat.txt`)
  fs.writeFileSync(concatListPath, processedMedia.map(p => `file '${p}'`).join('\n'))

  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(concatListPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y'])
      .output(videoPath)
      .on('end', resolve)
      .on('error', reject)
      .run()
  })

  // Clean up
  processedMedia.forEach(f => fs.unlinkSync(f))
  fs.unlinkSync(concatListPath)

  // Now move all uploaded files to archive
  for (const file of req.files) {
    const dest = path.join(archiveDir, path.basename(file.path))
    if (fs.existsSync(file.path)) {
      fs.renameSync(file.path, dest)
    }
  }

  res.send(`
    <html><body>
      <h2>Video Created!</h2>
      <video src="/video/${path.basename(videoPath)}" controls width="100%"></video><br>
      <a href="/video/${path.basename(videoPath)}" download>Download Video</a>
      <br><a href="/">Create Another</a>
    </body></html>
  `)
})

// Serve output video
app.get('/video/:name', (req, res) => {
  const videoPath = path.join(__dirname, req.params.name)
  if (fs.existsSync(videoPath)) res.sendFile(videoPath)
  else res.status(404).send('Video not found.')
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`))
