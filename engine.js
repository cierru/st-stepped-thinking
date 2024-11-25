import { getContext } from '../../../extensions.js';
import {
    addOneMessage,
    chat,
    event_types,
    eventSource,
    extractMessageBias,
    removeMacros,
    saveChatConditional,
    sendMessageAsUser,
    updateMessageBlock,
} from '../../../../script.js';
import { hideChatMessageRange } from '../../../chats.js';
import { getMessageTimeStamp } from '../../../RossAscends-mods.js';
import { extensionName, settings } from './index.js';
import { generationCaptured, releaseGeneration } from './interconnection.js';

let isThinking = false;
let toastThinking, sendTextareaOriginalPlaceholder;

/**
 * @return {CharacterThinkingSettings|undefined}
 */
export function getCurrentCharacterSettings() {
    const context = getContext();
    if (!Number.isInteger(Number(context.characterId))) {
        return;
    }

    const characterName = context.characters[context.characterId].name;
    return settings.character_settings?.find(setting => setting.name === characterName && setting.is_setting_enabled);
}

/**
 * @return {Promise<void>}
 */
export async function generationDelay() {
    if (settings.generation_delay > 0.0) {
        console.log('[Stepped Thinking] Delaying generation for', settings.generation_delay, 'seconds');
        await new Promise(resolve => setTimeout(resolve, settings.generation_delay * 1000));
        console.log('[Stepped Thinking] Generation delay complete');
    }
}

/**
 * @param {JQuery<HTMLTextAreaElement>} textarea
 * @return {void}
 */
export function stopThinking(textarea) {
    isThinking = false;
    if (toastThinking) {
        toastr.clear(toastThinking);
    }

    textarea.prop('readonly', false);

    if (sendTextareaOriginalPlaceholder) {
        textarea.attr('placeholder', sendTextareaOriginalPlaceholder);
    }

    releaseGeneration();
}

/**
 * @param {JQuery<HTMLTextAreaElement>} textarea
 * @return {Promise<void>}
 */
export async function runChatThinking(textarea) {
    if (isThinking || !settings.is_enabled) {
        return;
    }
    if (isThinkingSkipped()) {
        await hideThoughts();
        return;
    }

    await runThinking(textarea);
    await generationDelay();
}

/**
 * @param {JQuery<HTMLTextAreaElement>} textarea
 * @return {Promise<void>}
 */
export async function runThinking(textarea) {
    if (!generationCaptured()) {
        return;
    }
    isThinking = true;

    try {
        await sendUserMessage(textarea);

        await hideThoughts();
        await generateThoughtsWithDisabledInput(textarea);

        await hideThoughts();
    } finally {
        isThinking = false;
        releaseGeneration();
    }
}

/**
 * @param {JQuery<HTMLTextAreaElement>} textarea
 * @return {Promise<void>}
 */
async function sendUserMessage(textarea) {
    const text = String(textarea.val());
    if (text.trim() === '') {
        return;
    }

    const bias = extractMessageBias(text);

    textarea.val('')[0].dispatchEvent(new Event('input', { bubbles: true }));
    await sendMessageAsUser(text, bias);
}

/**
 * @return {Promise<void>}
 */
async function hideThoughts() {
    const context = getContext();
    const maxThoughts = settings.max_thoughts_in_prompt;

    const currentCharacter = context.characters[context.characterId];
    const characterSettings = getCurrentCharacterSettings();

    const isMindReaderCharacter = Boolean(characterSettings && characterSettings.is_mind_reader);
    const hasAccessToThought = (chatThoughtName) => isMindReaderCharacter || chatThoughtName === currentCharacter.name;

    let promises = [];
    const lastMessageIndex = context.chat.length - 1;
    for (let i = lastMessageIndex, thoughtsCount = []; i >= 0 && (lastMessageIndex - i < settings.max_hiding_thoughts_lookup); i--) {
        if (Boolean(context.chat[i]?.is_thoughts)) {
            const chatThoughtName = context.chat[i].thoughts_for || context.chat[i].name;
            thoughtsCount[chatThoughtName] ??= 0;
            if (thoughtsCount[chatThoughtName] < maxThoughts && hasAccessToThought(chatThoughtName)) {
                promises.push(hideChatMessageRange(i, i, true));
            } else {
                promises.push(hideChatMessageRange(i, i, false));
            }

            thoughtsCount[chatThoughtName]++;
        }
    }

    await Promise.all(promises);
}

/**
 * The Generate function sends input from #send_textarea before starting generation. Since the user probably doesn't
 * want their input to be suddenly sent when the character finishes thinking, the input field is disabled during the process
 *
 * @param {JQuery<HTMLTextAreaElement>} textarea
 * @return {Promise<void>}
 */
async function generateThoughtsWithDisabledInput(textarea) {
    sendTextareaOriginalPlaceholder = textarea.attr('placeholder');
    textarea.attr('placeholder', 'When a character is thinking, the input area is disabled');
    textarea.prop('readonly', true);
    textarea.val('')[0].dispatchEvent(new Event('input', { bubbles: true }));

    await generateThoughts();

    textarea.prop('readonly', false);
    textarea.attr('placeholder', sendTextareaOriginalPlaceholder);
    sendTextareaOriginalPlaceholder = null;
}

/**
 * @return {Promise<void>}
 */
async function generateThoughts() {
    const context = getContext();
    const characterThoughtsPosition = await sendCharacterTemplateMessage();

    if (settings.is_thinking_popups_enabled) {
        const toastThinkingMessage = context.substituteParams('{{char}} is thinking...');
        toastThinking = toastr.info(toastThinkingMessage, 'Stepped Thinking', { timeOut: 0, extendedTimeOut: 0 });
    }

    const prompts = getCurrentCharacterPrompts();
    for (let i = 0; i < prompts.length; i++) {
        if (prompts[i]?.prompt) {
            const thoughts = await generateCharacterThoughts(prompts[i].prompt);
            await insertCharacterThoughtsAt(characterThoughtsPosition, thoughts);

            if (prompts[i + 1]?.prompt) {
                await generationDelay();
            }
        }
    }

    toastr.clear(toastThinking);
    toastThinking = null;
    if (settings.is_thinking_popups_enabled) {
        toastr.success('Done!', 'Stepped Thinking', { timeOut: 2000 });
    }
}

/**
 * @return {Promise<number>}
 */
async function sendCharacterTemplateMessage() {
    const context = getContext();
    const openState = settings.is_thoughts_spoiler_open ? 'open' : '';

    const thoughtsMessage = settings.thoughts_message_template
        .replace('{{thoughts_spoiler_open_state}}', openState)
        .replace('{{thoughts_placeholder}}', replaceThoughtsPlaceholder(settings.thoughts_placeholder.default_content));

    return await sendCharacterThoughts(
        context.characters[context.characterId],
        thoughtsMessage
    );
}

/**
 * @param {string} prompt
 * @return {Promise<string>}
 */
async function generateCharacterThoughts(prompt) {
    const context = getContext();

    let result = await context.generateQuietPrompt(prompt, false, settings.is_wian_skipped, null, null, settings.max_response_length);

    if (settings.regexp_to_sanitize.trim() !== '') {
        const regexp = context.substituteParams(settings.regexp_to_sanitize);
        result = result.replace(new RegExp(regexp, 'g'), '');
    }

    return result;
}

/**
 * @param {number} position
 * @param {string} thoughts
 * @return {Promise<void>}
 */
async function insertCharacterThoughtsAt(position, thoughts) {
    const context = getContext();
    if (!context.chat[position]) {
        toastr.error('The message was not found at position ' + position + ', cannot insert thoughts. ' + 'Probably, the error was caused by unexpected changes in the chat.', 'Stepped Thinking', { timeOut: 10000 });
        return;
    }
    const message = context.chat[position];
    const defaultPlaceholder = replaceThoughtsPlaceholder(settings.thoughts_placeholder.default_content);

    const isFirstThought = (message) => message.mes.search(defaultPlaceholder) !== -1;

    if (isFirstThought(message)) {
        message.mes = message.mes.replace(defaultPlaceholder, replaceThoughtsPlaceholder(thoughts));
    } else {
        const lastThoughtEndIndex = message.mes.lastIndexOf(settings.thoughts_placeholder.end);

        if (lastThoughtEndIndex !== -1) {
            const indexToInsert = lastThoughtEndIndex + settings.thoughts_placeholder.end.length;
            message.mes = message.mes.substring(0, indexToInsert) + '\n' + replaceThoughtsPlaceholder(thoughts) + message.mes.substring(indexToInsert);
        } else {
            console.debug('[Stepped Thinking] Unable to locate the end of the previous thought, inserting a new thought at the end of the message');
            message.mes += '\n' + replaceThoughtsPlaceholder(thoughts);
        }
    }

    updateMessageBlock(position, message);

    await context.saveChat();
}

/**
 * @param {v1CharData} character
 * @param {string} text
 * @return {Promise<number>}
 */
async function sendCharacterThoughts(character, text) {
    const context = getContext();

    let mesText;

    mesText = text.trim();

    const bias = extractMessageBias(mesText);
    const isSystem = bias && !removeMacros(mesText).length;
    const isAuthorSystem = settings.is_thoughts_as_system;

    const message = {
        name: isAuthorSystem ? context.substituteParams(settings.system_character_name_template) : character.name,
        is_user: false,
        is_system: isSystem,
        is_thoughts: true,
        thoughts_for: character.name,
        send_date: getMessageTimeStamp(),
        mes: context.substituteParams(mesText),
        extra: {
            type: isAuthorSystem ? 'narrator' : undefined,
            bias: bias.trim().length ? bias : null,
            gen_id: Date.now(),
            isSmallSys: false,
            api: 'script',
            model: 'stepped thinking',
        },
        owner_extension: extensionName,
    };

    message.swipe_id = 0;
    message.swipes = [message.mes];
    message.swipes_info = [{
        send_date: message.send_date, gen_started: null, gen_finished: null, extra: {
            bias: message.extra.bias,
            gen_id: message.extra.gen_id,
            isSmallSys: false,
            api: 'script',
            model: 'stepped thinking',
        },
    }];

    if (context.groupId || isAuthorSystem) {
        message.original_avatar = character.avatar;
        message.force_avatar = context.getThumbnailUrl('avatar', character.avatar);
    }

    chat.push(message);

    const position = chat.length - 1;

    await eventSource.emit(event_types.MESSAGE_RECEIVED, (position));
    addOneMessage(message);
    await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, (position));
    await saveChatConditional();

    return position;
}

/**
 * @param {string} substitution
 * @return {string}
 */
function replaceThoughtsPlaceholder(substitution) {
    const thoughtsPlaceholder = settings.thoughts_placeholder.start
        + settings.thoughts_placeholder.content
        + settings.thoughts_placeholder.end;
    return thoughtsPlaceholder.replace('{{thoughts}}', substitution);
}

/**
 * @return {boolean}
 */
function isThinkingSkipped() {
    const characterSettings = getCurrentCharacterSettings();

    return (characterSettings && !characterSettings.is_thinking_enabled)
        || getCurrentCharacterPrompts().length === 0;
}

/**
 * @return {ThinkingPrompt[]}
 */
function getCurrentCharacterPrompts() {
    const characterSettings = getCurrentCharacterSettings();

    if (characterSettings) {
        const characterPrompts = characterSettings.thinking_prompts.filter(prompt => prompt.is_enabled !== false);
        if (characterPrompts && characterPrompts.length > 0) {
            return characterPrompts;
        }
    }

    return settings.thinking_prompts.filter(prompt => prompt.is_enabled !== false);
}
