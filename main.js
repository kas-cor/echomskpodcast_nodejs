require('dotenv').config();

const https = require('node:https');
const path = require('node:path');
const {promises: fsPromises} = require('node:fs');
const sharp = require('sharp');
const {spawn} = require('child_process');

const TelegramBot = require('node-telegram-bot-api');
const {XMLParser} = require('fast-xml-parser');

const database = require('./db');
const Programs = require('./Programs');

// Constants
const TWO_HOURS_IN_MS = 2 * 60 * 60 * 1000;
const YT_DLP_PATH = './yt-dlp';

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
    baseApiUrl: process.env.TELEGRAM_ENTRYPOINT || 'https://api.telegram.org',
});

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
});

/**
 * Filters text by replacing special HTML entities and other characters.
 * @param {string} text The input text.
 * @returns {string} The filtered text.
 */
const string_filter = text => {
    const replacements = {
        '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': '\'',
        '&lsqb;': '[', '&rsqb;': ']', '&Hat;': '^', '&sol;': '/', '&lpar;': '(',
        '&rpar;': ')', '&plus;': '+', '&bsol;': '\\', '&nbsp;': ' ', '&copy;': '©',
        '*': '', '_': ' ',
    };
    const pattern = Object.keys(replacements)
        .map(key => key.replace(/[.*+?^${}()|\[\]\\]/g, '\\$&'))
        .join('|');
    const regex = new RegExp(pattern, 'g');
    return text.replace(regex, match => replacements[match]).trim();
};

/**
 * Checks if a video ID is already present in the list of video IDs.
 * @param {string} video_id The video ID to check.
 * @param {string[]} video_ids An array of video IDs.
 * @returns {boolean} True if the video ID is present, false otherwise.
 */
const video_id_is_present = (video_id, video_ids) => video_ids.includes(video_id);

/**
 * Adds a new video ID to the list, maintaining a maximum of 20 IDs.
 * @param {string} video_id The new video ID to add.
 * @param {string[]} video_ids The current array of video IDs.
 * @returns {string[]} The updated array of video IDs.
 */
const add_new_video_id = (video_id, video_ids) => {
    const video_ids_arr = [...video_ids, video_id];
    if (video_ids_arr.length > 20) {
        video_ids_arr.shift();
    }
    return video_ids_arr;
};

/**
 * Extracts channel information from the XML feed.
 * @param {object} xml The parsed XML object.
 * @returns {{author_name: string, author_url: string}} The channel's author name and URL.
 */
const extract_channel_from_xml = xml => ({
    author_name: string_filter(xml.feed.author.name),
    author_url: xml.feed.author.uri,
});

/**
 * Fetches and parses an XML feed from a URL.
 * @param {string} url The URL of the RSS feed.
 * @returns {Promise<object>} A promise that resolves with the parsed XML object.
 */
const get_xml = url => new Promise(resolve => {
    https.get(`${url}&nocache=${Math.random()}`, resp => {
        let data = '';
        resp.on('data', chunk => {
            data += chunk;
        });
        resp.on('end', () => {
            resolve(parser.parse(data));
        });
    });
});

/**
 * Executes a command using yt-dlp.
 * @param {string[]} params An array of parameters for the command.
 * @returns {Promise<string>} A promise that resolves with the command's stdout.
 */
const youtube_dl = params => new Promise(async (resolve, reject) => {
    await new Promise(res => setTimeout(res, 5000));
    const child = spawn(YT_DLP_PATH, params);

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', data => {
        output += data.toString();
    });
    child.stderr.on('data', data => {
        errorOutput += data.toString();
    });

    child.on('close', code => {
        if (code === 0) {
            resolve(output.trim());
        } else {
            reject(errorOutput.trim());
        }
    });
});

/**
 * Fetches video information using yt-dlp.
 * @param {string} video_id The unique video ID.
 * @returns {Promise<object>} A promise that resolves with the video information.
 */
const get_info = video_id => youtube_dl(['-j', `ytsearch:"${video_id}"`]).then(JSON.parse);

/**
 * Downloads audio from a video.
 * @param {string} video_id The unique video ID.
 * @returns {Promise<object>} A promise that resolves with file paths for the audio and thumbnail.
 */
const download_audio = async video_id => {
    const filepath = path.join(__dirname, 'audio', `${video_id}.mp3`);
    const thumbnailWebpPath = `${filepath}.webp`;
    const thumbnailJpgPath = `${filepath}.jpg`;

    const params = [
        '-f', 'ba',
        '--audio-format', 'mp3',
        '--write-thumbnail',
        '--embed-thumbnail',
        '-o', filepath,
        `ytsearch:"${video_id}"`,
    ];

    const stdout = await youtube_dl(params);
    await sharp(thumbnailWebpPath).resize({width: 320, height: 320, fit: 'inside'}).jpeg().toFile(thumbnailJpgPath);

    return {
        stdout,
        audio_file: filepath,
        thumbnail_file: thumbnailJpgPath,
    };
};

/**
 * Updates the program's state in the database.
 * @param {object} program The program item from the database.
 * @param {string|null} video_id The video ID to add to the list of processed videos.
 * @returns {Promise<void>}
 */
const updateProgramState = (program, video_id = null) => {
    program.index = 0;
    program.state = 0;
    if (video_id) {
        program.video_ids = add_new_video_id(video_id, program.video_ids);
    }
    return program.save();
};

/**
 * Deletes temporary files associated with a video.
 * @param {string} video_id The video ID.
 * @returns {Promise<void>}
 */
const deleteTemporaryFiles = async video_id => {
    const baseFilepath = path.join(__dirname, 'audio', video_id);
    const filesToDelete = [
        `${baseFilepath}.mp3`,
        `${baseFilepath}.webp`,
        `${baseFilepath}.jpg`,
        `${baseFilepath}.mp3.webp`,
        `${baseFilepath}.mp3.jpg`,
    ];

    const deletionPromises = filesToDelete.map(file =>
        fsPromises.unlink(file).catch(e => {
            console.error(`Error deleting file: ${file}`, e.message);
        })
    );

    await Promise.allSettled(deletionPromises);
};

/**
 * Handles errors during the process, updating the program state accordingly.
 * @param {object} program The program item.
 * @param {string} err The error description.
 * @returns {Promise<void>}
 */
const save_after_error = (program, err) => {
    program.state = 0;
    if (/This live event/im.test(err)) {
        program.index += 1;
    }
    return program.save();
};

/**
 * Sets the program state to "downloading".
 * @param {object} program The program item.
 * @returns {Promise<void>}
 */
const save_before_download = program => {
    program.state = 1;
    return program.save();
};

/**
 * Sends an audio file to a Telegram channel.
 * @param {object} data The data for the audio message.
 * @returns {Promise<object>} The response from the Telegram API.
 */
const send_audio = data => bot.sendAudio(process.env.TELEGRAM_CHANNEL, data.audio_file, {
    caption: [
        `*${data.title}*`,
        `📅 _Опубликовано: ${new Date().toLocaleDateString('ru-RU')}_`,
        `[Оригинал видео](https://youtu.be/${data.video_id})\n[YouTube канал ${data.channel.author_name}](${data.channel.author_url})`,
        [
            data.tag ? `#${data.tag}` : null,
            process.env.TELEGRAM_CHANNEL_URL ? `[${process.env.TELEGRAM_CHANNEL}](${process.env.TELEGRAM_CHANNEL_URL})` : process.env.TELEGRAM_CHANNEL,
            process.env.TELEGRAM_CHANNEL_BOOST_URL ? `[Буст каналу](${process.env.TELEGRAM_CHANNEL_BOOST_URL})` : null,
        ].filter(Boolean).join("\n"),
    ].join("\n\n"),
    parse_mode: 'markdown',
    duration: data.duration,
    performer: data.channel.author_name,
    title: data.title,
    thumb: data.thumb,
}, {
    filename: path.basename(data.audio_file),
    contentType: 'audio/mpeg',
});

/**
 * The main processing script for a single program.
 * @param {object} program The program item to process.
 */
const main = async program => {
    console.log(program.id, 'get xml', program.url, program.tag);
    try {
        const xml = await get_xml(program.url);
        const entry = Array.isArray(xml.feed.entry) ? xml.feed.entry[program.index] : xml.feed.entry;
        const video_id = entry ? entry['yt:videoId'] : null;

        if (!video_id) {
            console.error(program.id, 'No video ID found.');
            await updateProgramState(program);
            return;
        }

        if (video_id_is_present(video_id, program.video_ids)) {
            console.log(program.id, 'video already processed, skipping.');
            await updateProgramState(program);
            return;
        }

        console.log(program.id, 'get info...');
        const info = await get_info(video_id);
        const title = string_filter(entry.title);
        console.log(program.id, 'info:', {
            is_live: info.is_live,
            original_url: info.original_url,
            duration: info.duration,
            title: title
        });

        if (info.duration && !info.is_live && !info.original_url.includes('shorts')) {
            await save_before_download(program);
            console.log(program.id, 'downloading audio...');
            try {
                const {audio_file, thumbnail_file} = await download_audio(video_id);
                console.log(program.id, 'download complete.', {audio_file, thumbnail_file});

                console.log(program.id, 'sending to Telegram...');
                await send_audio({
                    audio_file,
                    video_id,
                    tag: program.tag,
                    duration: info.duration,
                    title: title,
                    channel: extract_channel_from_xml(xml),
                    thumb: thumbnail_file,
                });
                console.log(program.id, 'sent to Telegram.');

                await updateProgramState(program, video_id);
                await deleteTemporaryFiles(video_id);

            } catch (err) {
                console.error(program.id, 'Error during download or send:', err);
                await save_after_error(program, err.toString());
                if (video_id) await deleteTemporaryFiles(video_id);
            }
        } else {
            console.log(program.id, 'is live or shorts, skipping.');
            await updateProgramState(program);
        }
    } catch (err) {
        console.error(program.id, 'Unhandled error in main:', err);
        await save_after_error(program, err.toString());
    }
};

/**
 * Initializes and runs the application.
 */
const init = async () => {
    await database.sync({alter: true});
    const args = process.argv.slice(2);
    const command = args[0];
    const command_arg1 = args[1];
    const command_arg2 = args[2];

    if (command === 'help') {
        console.log('Usage: node main.js [command]');
        console.log('Commands:');
        console.log('  add {channel_id}[|{channel_id}] - Add one or more YouTube channels');
        console.log('  list                            - List all channels');
        console.log('  remove {id}                     - Remove a channel');
        console.log('  tag {id} {tagName}              - Assign a tag to a channel');
        console.log('  reset_all_states                - Reset states for all channels');
        console.log('  reset_state {id}                - Reset state for a specific channel');
        console.log('  reset_ids {id}                  - Reset processed video IDs for a channel');
        return;
    }

    if (command === 'list') {
        const programs = await Programs.findAll();
        programs.forEach(p => console.log(p.id, p.url, p.state, p.tag || ''));
        return;
    }

    if (command === 'add' && command_arg1) {
        const channel_ids = command_arg1.split('|');
        for (const channel_id of channel_ids) {
            await Programs.create({
                url: `https://www.youtube.com/feeds/videos.xml?channel_id=${channel_id}`,
                index: 0,
                state: 0,
                video_ids: [],
            });
        }
        return;
    }

    if (command === 'remove' && command_arg1) {
        await Programs.destroy({where: {id: command_arg1}});
        return;
    }

    if (command === 'reset_all_states') {
        await Programs.update({state: 0}, {where: {}});
        return;
    }

    if (command === 'reset_state' && command_arg1) {
        await Programs.update({state: 0}, {where: {id: command_arg1}});
        return;
    }

    if (command === 'reset_ids' && command_arg1) {
        await Programs.update({video_ids: []}, {where: {id: command_arg1}});
        return;
    }

    if (command === 'tag' && command_arg1 && command_arg2) {
        await Programs.update({tag: command_arg2}, {where: {id: command_arg1}});
        return;
    }

    if (!command) {
        const programs = await Programs.findAll({where: {state: 0}});
        const stuckPrograms = await Programs.findAll({where: {state: 1}});

        for (const program of stuckPrograms) {
            if (new Date() - new Date(program.updatedAt) > TWO_HOURS_IN_MS) {
                program.state = 0;
                await program.save();
                programs.push(program);
            }
        }

        if (programs.length > 0) {
            await Promise.all(programs.map(p => main(p)));
        }
        console.log('Finish');
    }
};

init().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
