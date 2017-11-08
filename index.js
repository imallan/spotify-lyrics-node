import spotify from 'spotify-node-applescript'
import request from 'request'
import chalk from 'chalk'
import readline from 'readline'

function clearConsole() {
  process.stdout.write('\x1Bc')
}

let songCandidates
let playingTrackNetease

async function searchId(track) {
  const responseEncoding = 'utf8'
  const httpOptions = {
    url: `http://music.163.com/api/search/get/?s=${encodeURI(track.name)}&type=1&offset=0&limit=20`,
    headers: { Referer: 'http://music.163.com/search/' },
  }
  return new Promise((resolve, reject) => {
    request.post(httpOptions, (error, response, body) => {
      if (error) {
        console.error(error)
        songCandidates = null
        reject(error)
      }
      const songs = JSON.parse(body).result.songs
      songCandidates = songs
      if (songs && songs.length > 0) {
        let bestResult = null
        songs.forEach((song) => {
          if (Math.abs(song.duration - track.duration) <= 100) {
            bestResult = song
          }
        })
        if (!bestResult) {
          songs.forEach((song) => {
            if (Math.abs(song.duration - track.duration) <= 1000) {
              bestResult = song
            }
          })
        }
        if (!bestResult) {
          bestResult = songs[0]
        }
        playingTrackNetease = bestResult
        resolve(bestResult.id)
      } else {
        reject(new Error('Song not found'))
      }
    })
  })
}

async function getLyrics(id) {
  return new Promise((resolve, reject) => {
    request.get({
      url: `http://music.163.com/api/song/lyric?os=pc&id=${id}&lv=-1&kv=-1&tv=-1`,
    }, (error, response, body) => {
      if (error) {
        console.error(error)
        reject(error)
      }
      resolve(JSON.parse(body))
    })
  })
}

async function getLyricsFromTrack(track) {
  const id = await searchId(track)
  const lyrics = await getLyrics(id)
  return new Promise((resolve, reject) => {
    if (lyrics && lyrics.lrc) {
      resolve(lyrics.lrc.lyric)
    } else {
      reject(new Error('Lyrics parsing error'))
    }
  })
}

const timestampRegex = /(\d+):(\d{2})\.(\d+)/

function convertTimeStrToMilliseconds(timeStr) {
  if (!timestampRegex.test(timeStr)) return -1
  const exec = timestampRegex.exec(timeStr)
  const minutes = parseInt(exec[1], 10)
  const seconds = parseInt(exec[2], 10)
  const milliseconds = parseInt(exec[3], 10)
  return (((minutes * 60) + seconds) * 1000) + milliseconds
}

const lyricRegex = /^\[(\d+:\d{2}\.\d+)\]([^$]*)/

function processLyricsWithTimestamps(lyrics) {
  const output = []
  const lines = lyrics.split('\n')
  lines.forEach((line) => {
    if (lyricRegex.test(line)) {
      const result = lyricRegex.exec(line)
      output.push({
        time: convertTimeStrToMilliseconds(result[1]),
        timeStr: result[1],
        text: result[2],
      })
    }
  })
  return output
}

let playingTrack
let playingLyrics
let playingTimeStamp = 0

function getTrack() {
  clearConsole()
  spotify.getTrack((err, track) => {
    if (err) {
      return
    }

    playingTrack = track
    getLyricsFromTrack(track)
      .then((it) => {
        playingLyrics = processLyricsWithTimestamps(it)
      })
      .catch(it => console.error(it))
  })
}

const stateIntervalId = setInterval(() => {
  spotify.getState((err, state) => {
    if (err) {
      console.error(err)
      clearInterval(stateIntervalId)
      return
    }
    if (playingTrack && state.track_id !== playingTrack.id) {
      playingLyrics = null
      playingTrack = null
      playingTimeStamp = 0
      getTrack()
    }
    playingTimeStamp = state.position
  })
}, 1000)

const lyricsIntervalId = setInterval(() => {
  if (playingTrack) {
    process.stdout.write('\r\x1b[K')
    const elapsed = `${Math.floor(playingTimeStamp / 60)}:${playingTimeStamp % 60}`
    const total = `${Math.floor(playingTrack.duration / 60000)}:${(playingTrack.duration % 60000) / 1000}`
    process.stdout.write(`${chalk.green(playingTrack.name)} [${elapsed}/${total}] `)
    if (playingLyrics) {
      for (let i = 0; i < playingLyrics.length; i += 1) {
        if (playingLyrics[i].time >= playingTimeStamp * 1000) {
          process.stdout.write(`${chalk.bold(playingLyrics[(i - 1) > 0 ? i - 1 : 0].text)}`)
          break
        }
      }
    }
  }
}, 500)

getTrack()

if (process.stdin.isTTY) {
  readline.emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)
  process.stdin.on('keypress', (str, key) => {
    if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
      process.exit()
      return
    }
    if (key.name === 'i') {
      clearConsole()
      console.log(playingTrack)
      console.log(playingTrackNetease)
      return
    }
    if (key.name === 'p') {
      spotify.playPause(() => {
        spotify.getState((err, state) => {
          if (!err && state) {
            console.log(state.state)
          }
        })
      })
      return
    }
    if (key.name === 'n') {
      clearConsole()
      if (key.shift) {
        spotify.previous()
      } else {
        spotify.next()
      }
      return
    }
    if (key.name === 'j') {
      clearConsole()
      spotify.next()
    }
    if (key.name === 'k') {
      clearConsole()
      spotify.previous()
    }
    if (key.name === 'l') {
      clearConsole()
      if (playingLyrics) {
        playingLyrics.forEach(it => console.log(it.text))
      }
      return
    }
    if (key.name === 'return') {
      clearConsole()
    }
  })
}
