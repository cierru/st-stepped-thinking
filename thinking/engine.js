import { getContext } from '../../../../extensions.js';
import {
    eventSource,
    extractMessageBias,
    sendMessageAsUser,
} from '../../../../../script.js';
import { generationCaptured, releaseGeneration } from '../interconnection.js';
import { settings } from '../settings/settings.js';

let isThinking = false;
let toastThinking, sendTextareaOriginalPlaceholder;

export const thinkingEvents = {
    ON_HIDE_THOUGHTS: 'ON_HIDE_THOUGHTS',
    ON_SEND_THOUGHTS_TEMPLATE: 'ON_SEND_THOUGHTS_TEMPLATE',
    ON_PUT_THOUGHTS: 'ON_PUT_THOUGHTS',
};

class ThinkingEvent {
    #defaultPrevented = false;

    get defaultPrevented() {
        return this.#defaultPrevented;
    }

    preventDefault() {
        this.#defaultPrevented = true;
    }
}

class OnSendThoughtsTemplateEvent extends ThinkingEvent {
    #coordinates;

    set coordinates(coordinates) {
        this.#coordinates = coordinates;
    }

    get coordinates() {
        return this.#coordinates;
    }
}

class OnPutThoughtsEvent extends ThinkingEvent {
    #coordinates;
    #thoughts;

    constructor(coordinates, thoughts) {
        super();
        this.#coordinates = coordinates;
        this.#thoughts = thoughts;
    }

    get coordinates() {
        return this.#coordinates;
    }

    get thoughts() {
        return this.#thoughts;
    }
}

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
 * @param {array?} targetPromptIds
 * @return {Promise<void>}
 */
export async function runThinking(textarea, targetPromptIds = null) {
    if (!generationCaptured()) {
        return;
    }
    isThinking = true;

    try {
        await sendUserMessage(textarea);

        await hideThoughts();
        await generateThoughtsWithDisabledInput(textarea, targetPromptIds);

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
 * The Generate function sends input from #send_textarea before starting generation. Since the user probably doesn't
 * want their input to be suddenly sent when the character finishes thinking, the input field is disabled during the process
 *
 * @param {JQuery<HTMLTextAreaElement>} textarea
 * @param {array?} targetPromptIds
 * @return {Promise<void>}
 */
async function generateThoughtsWithDisabledInput(textarea, targetPromptIds = null) {
    sendTextareaOriginalPlaceholder = textarea.attr('placeholder');
    textarea.attr('placeholder', 'When a character is thinking, the input area is disabled');
    textarea.prop('readonly', true);
    textarea.val('')[0].dispatchEvent(new Event('input', { bubbles: true }));

    await generateThoughts(targetPromptIds);

    textarea.prop('readonly', false);
    textarea.attr('placeholder', sendTextareaOriginalPlaceholder);
    sendTextareaOriginalPlaceholder = null;
}

/**
 * @param {array?} targetPromptIds
 * @return {Promise<void>}
 */
async function generateThoughts(targetPromptIds = null) {
    const context = getContext();
    const coordinates = await sendCharacterTemplateMessage();

    if (settings.is_thinking_popups_enabled) {
        const toastThinkingMessage = context.substituteParams('{{char}} is thinking...');
        toastThinking = toastr.info(toastThinkingMessage, 'Stepped Thinking', { timeOut: 0, extendedTimeOut: 0 });
    }

    const isInTargetPrompts = (promptId) => !targetPromptIds || targetPromptIds.includes(String(promptId));

    const prompts = getCurrentCharacterPrompts();
    for (let i = 0; i < prompts.length; i++) {
        if (prompts[i]?.prompt && isInTargetPrompts(prompts[i].id)) {
            const thoughts = await generateCharacterThoughts(prompts[i].prompt);
            await putCharactersThoughts(coordinates, thoughts);

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
 * @return {Promise<void>}
 */
async function hideThoughts() {
    await eventSource.emit(thinkingEvents.ON_HIDE_THOUGHTS, new ThinkingEvent());
}

/**
 * @return {Promise<number>}
 */
async function sendCharacterTemplateMessage() {
    const event = new OnSendThoughtsTemplateEvent();
    await eventSource.emit(thinkingEvents.ON_SEND_THOUGHTS_TEMPLATE, event);

    return event.coordinates;
}

/**
 * @param {number} coordinates
 * @param {string} thoughts
 * @return {Promise<void>}
 */
async function putCharactersThoughts(coordinates, thoughts) {
    await eventSource.emit(thinkingEvents.ON_PUT_THOUGHTS, new OnPutThoughtsEvent(coordinates, thoughts));
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
