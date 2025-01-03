import { getContext } from '../../../../extensions.js';
import {
    event_types,
    eventSource,
    extractMessageBias,
    sendMessageAsUser,
    substituteParams,
} from '../../../../../script.js';
import { generationCaptured, releaseGeneration } from '../interconnection.js';
import { settings } from '../settings/settings.js';
import { is_group_generating } from '../../../../group-chats.js';

let isThinking = false;
let toastThinking, sendTextareaOriginalPlaceholder;

export const thinkingEvents = {
    ON_HIDE: 'ON_HIDE_THOUGHTS',
    ON_SEND_TEMPLATE: 'ON_SEND_THOUGHTS_TEMPLATE',
    ON_PUT: 'ON_PUT_THOUGHTS',
    ON_SAVE: 'ON_SAVE_THOUGHTS',
    ON_RENDER: 'ON_RENDER_THOUGHTS',
    ON_MAKE_ORPHANS: 'ON_MAKE_INTERMEDIATE_THOUGHTS_ORPHANS',
    ON_REMOVE_ORPHANS: 'ON_REMOVE_ORPHAN_THOUGHTS',
    ON_PREPARE_GENERATION: 'ON_PREPARE_GENERATION_THOUGHTS',
    ON_APPLY_EDITS: 'ON_APPLY_INTERMEDIATE_EDITS',
};

/**
 * @typedef {object} ThoughtsBlockCoordinates
 * @property {?number} thoughtsMessageId
 * @property {?string} thoughtsMetadataId
 */

export class ThinkingEvent {
    /**
     * @var {boolean}
     */
    #defaultPrevented = false;

    get defaultPrevented() {
        return this.#defaultPrevented;
    }

    preventDefault() {
        this.#defaultPrevented = true;
    }
}

export class OnHideThoughtsEvent extends ThinkingEvent {
    /**
     * @var {number}
     */
    #targetCharacterId;

    constructor(targetCharacterId) {
        super();
        this.#targetCharacterId = targetCharacterId;
    }

    get targetCharacterId() {
        return this.#targetCharacterId;
    }
}

export class OnSendThoughtsTemplateEvent extends ThinkingEvent {
    /**
     * @var {ThoughtsBlockCoordinates}
     */
    #coordinates = { thoughtsMessageId: null, thoughtsMetadataId: null };

    set thoughtsMessageId(id) {
        this.#coordinates.thoughtsMessageId = id;
    }

    set thoughtsMetadataId(id) {
        this.#coordinates.thoughtsMetadataId = id;
    }

    get coordinates() {
        return this.#coordinates;
    }
}

export class OnPutThoughtsEvent extends ThinkingEvent {
    /**
     * @var {ThoughtsBlockCoordinates}
     */
    #coordinates;
    /**
     * @var {string}
     */
    #thought;
    /**
     * @var {ThinkingPrompt}
     */
    #thinkingPrompt;

    constructor(coordinates, thought, thinkingPrompt) {
        super();
        this.#coordinates = coordinates;
        this.#thought = thought;
        this.#thinkingPrompt = thinkingPrompt;
    }

    get thoughtsMessageId() {
        return this.#coordinates.thoughtsMessageId;
    }

    get thoughtsMetadataId() {
        return this.#coordinates.thoughtsMetadataId;
    }

    get thinkingPrompt() {
        return this.#thinkingPrompt;
    }

    get thought() {
        return this.#thought;
    }
}

export class OnSaveThoughtsEvent extends ThinkingEvent {
    /**
     * @var {number}
     */
    #messageId;

    constructor(messageId) {
        super();
        this.#messageId = messageId;
    }

    get messageId() {
        return this.#messageId;
    }
}

export class OnRenderThoughtsEvent extends ThinkingEvent {
    /**
     * @var {boolean}
     */
    #isInitialCall;

    constructor(isInitialCall) {
        super();
        this.#isInitialCall = isInitialCall;
    }

    get isInitialCall() {
        return this.#isInitialCall;
    }
}

// event listeners

/**
 * @return {void}
 */
export function registerGenerationEventListeners() {
    if (settings.is_shutdown) {
        return;
    }

    eventSource.on(event_types.GENERATION_STOPPED, stopChatThinking);
    // todo remove afterwards
    eventSource.on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, (event) => console.log('STDEBUG Final Prompt', event.prompt));
    eventSource.on(event_types.GENERATION_STARTED, applyIntermediateEdits);
    eventSource.on(event_types.GENERATION_STARTED, removeOrphanThoughts);
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, runChatThinking);
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, prepareGenerationPrompt);

    eventSource.on(event_types.MESSAGE_RECEIVED, saveLastThoughts);
    eventSource.on(event_types.MESSAGE_DELETED, renderAndHideThoughts);
    eventSource.on(event_types.CHAT_CHANGED, renderInitialThoughts);
    $(document).on('mouseup touchend', '#show_more_messages', renderThoughts);
    $(document).on('click', '.mes_hide', hideThoughts);
    $(document).on('click', '.mes_unhide', hideThoughts);
}

/**
 * @returns {Promise<void>}
 */
async function stopChatThinking() {
    await stopThinking($('#send_textarea'));
}

/**
 * @param {string} type
 * @return {Promise<void>}
 */
async function runChatThinking(type) {
    if (!settings.is_enabled || !isGenerationTypeAllowed(type) || isThinking) {
        return;
    }
    if (isThinkingSkipped()) {
        await hideThoughts();
        return;
    }

    await runThinking($('#send_textarea'));
    await generationDelay();
}

/**
 * @param {?string} type
 * @return {boolean}
 */
function isGenerationTypeAllowed(type) {
    if (getContext().groupId) {
        if (!is_group_generating) {
            return false;
        }
        if (type !== 'normal' && type !== 'group_chat') {
            return false;
        }
    } else {
        if (type) {
            return false;
        }
    }

    return true;
}

/**
 * @return {Promise<void>}
 */
async function saveLastThoughts() {
    await eventSource.emit(thinkingEvents.ON_SAVE, new OnSaveThoughtsEvent(getContext().chat.length - 1));
}

/**
 * @return {Promise<void>}
 */
async function renderInitialThoughts() {
    await eventSource.emit(thinkingEvents.ON_RENDER, new OnRenderThoughtsEvent(true));
}

/**
 * @return {Promise<void>}
 */
async function renderThoughts() {
    await eventSource.emit(thinkingEvents.ON_RENDER, new OnRenderThoughtsEvent(false));
}

/**
 * @return {Promise<void>}
 */
async function renderAndHideThoughts() {
    await renderThoughts();
    await hideThoughts();
}

/**
 * @return {Promise<void>}
 */
async function hideThoughts() {
    const characterId = Number(getContext().characterId);
    if (!Number.isInteger(characterId)) {
        return;
    }

    await eventSource.emit(thinkingEvents.ON_HIDE, new OnHideThoughtsEvent(characterId));
}

/**
 * @return {Promise<ThoughtsBlockCoordinates>}
 */
async function sendCharacterTemplateMessage() {
    const event = new OnSendThoughtsTemplateEvent();
    await eventSource.emit(thinkingEvents.ON_SEND_TEMPLATE, event);

    return event.coordinates;
}

/**
 * @return {Promise<void>}
 */
async function prepareGenerationPrompt() {
    await eventSource.emit(thinkingEvents.ON_PREPARE_GENERATION, new ThinkingEvent());
}

/**
 * @return {Promise<void>}
 */
async function applyIntermediateEdits() {
    await eventSource.emit(thinkingEvents.ON_APPLY_EDITS, new ThinkingEvent());
}

/**
 * @param {ThoughtsBlockCoordinates} coordinates
 * @param {string} thought
 * @param {ThinkingPrompt} thinkingPrompt
 * @return {Promise<void>}
 */
async function putCharactersThoughts(coordinates, thought, thinkingPrompt) {
    const thinkingPromptSubstituted = {
        ...thinkingPrompt,
        ...{
            name: substituteParams(thinkingPrompt.name),
            prompt: substituteParams(thinkingPrompt.prompt),
        }
    };
    await eventSource.emit(thinkingEvents.ON_PUT, new OnPutThoughtsEvent(coordinates, thought, thinkingPromptSubstituted));
}

/**
 * @return {Promise<void>}
 */
async function makeIntermediateThoughtsOrphans() {
    await eventSource.emit(thinkingEvents.ON_MAKE_ORPHANS, new ThinkingEvent());
}

/**
 * @return {Promise<void>}
 */
async function removeOrphanThoughts() {
    await eventSource.emit(thinkingEvents.ON_REMOVE_ORPHANS, new ThinkingEvent());
}


// core functions

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
export async function stopThinking(textarea) {
    isThinking = false;
    if (toastThinking) {
        toastr.clear(toastThinking);
    }

    textarea.prop('readonly', false);

    if (sendTextareaOriginalPlaceholder) {
        textarea.attr('placeholder', sendTextareaOriginalPlaceholder);
    }

    await makeIntermediateThoughtsOrphans();

    releaseGeneration();
}

/**
 * @param {JQuery<HTMLTextAreaElement>} textarea
 * @param {?array} targetPromptIds
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
 * @param {?array} targetPromptIds
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
 * @param {?array} targetPromptIds
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
            const thought = await generateCharacterThought(prompts[i].prompt);
            await putCharactersThoughts(coordinates, thought, prompts[i]);

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
async function generateCharacterThought(prompt) {
    const context = getContext();

    let result = await context.generateQuietPrompt(
        prompt,
        false,
        settings.is_wian_skipped,
        null,
        null,
        settings.max_response_length
    );

    if (settings.regexp_to_sanitize.trim() !== '') {
        const regexp = context.substituteParams(settings.regexp_to_sanitize);
        result = result.replace(new RegExp(regexp, 'g'), '');
    }

    return result;
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
