import { getContext } from '../../../../extensions.js';
import {
    event_types,
    eventSource,
    extractMessageBias,
    Generate,
    sendMessageAsUser,
    substituteParams,
} from '../../../../../script.js';
import { generationCaptured, releaseGeneration } from '../interconnection.js';
import { settings } from '../settings/settings.js';
import { is_group_generating } from '../../../../group-chats.js';
import { EmbeddedThoughtsRefreshPlan, findMode, registerThinkingModeListeners } from './mode.js';
import { registerPromptAdjustmentListeners } from './prompt_adjustment.js';

/**
 * @type {{is_enabled: ?boolean, thinking_prompt_ids: ?number[]}}
 */
let chatThinkingSettings = {
    is_enabled: null,
    thinking_prompt_ids: null,
};

/**
 * @type {ThoughtsMode}
 */
let currentMode;
/**
 * @type {ThoughtsGenerationPlan}
 */
let currentGenerationPlan;

/**
 * @type {boolean}
 */
let isThinking = false;
let toastThinking, sendTextareaOriginalPlaceholder;

// event listeners

/**
 * @return {void}
 */
export function registerGenerationEventListeners() {
    if (settings.is_shutdown) {
        return;
    }

    eventSource.on(event_types.GENERATION_STOPPED, stopChatThinking);
    // DEBUG
    // eventSource.on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, (event) => console.log('STDEBUG TC Final Prompt', event.prompt));
    // eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, (event) => console.log('STDEBUG CC Final Prompt', event.chat));
    //
    eventSource.on(event_types.GENERATION_STARTED, removeOrphanThoughts);
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, runChatThinking);
    eventSource.makeLast(event_types.GENERATION_AFTER_COMMANDS, prepareGenerationPrompt);

    eventSource.on(event_types.MESSAGE_RECEIVED, saveCharacterThoughts);
    eventSource.on(event_types.MESSAGE_DELETED, renderAndHideThoughts);
    eventSource.on(event_types.CHAT_CHANGED, renderInitialThoughts);
    $(document).on('mouseup touchend', '#show_more_messages', renderThoughts);
    $(document).on('click', '.mes_hide', onHideClick);
    $(document).on('click', '.mes_unhide', onHideClick);

    registerThinkingModeListeners();
    registerPromptAdjustmentListeners();
}

/**
 * @return {Promise<void>}
 */
export async function hideThoughts() {
    const characterId = parseInt(getContext().characterId);
    if (Number.isNaN(characterId)) {
        return;
    }

    await currentGenerationPlan.hideThoughts(characterId);
}

/**
 * @return {Promise<void>}
 */
async function onHideClick() {
    const messageBlock = $(this).closest('.mes');
    const messageId = Number(messageBlock.attr('mesid'));

    const context = getContext();
    const characterName = context.chat[messageId].name;
    await currentGenerationPlan.hideThoughts(context.characters.findIndex(character => character.name === characterName));
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
async function renderInitialThoughts() {
    await currentMode.renderInitialCharacterThoughts();
}

/**
 * @return {Promise<void>}
 */
async function renderThoughts() {
    await currentMode.renderCharacterThoughts();
}

/**
 * @return {Promise<void>}
 */
async function removeOrphanThoughts() {
    if (!isThinking) {
        await bindIntermediateThoughts();
    }
    currentMode.removeOrphanThoughts();
}

/**
 * @return {Promise<void>}
 */
async function saveCharacterThoughts() {
    await currentGenerationPlan.saveCharacterThoughts();
    currentGenerationPlan = currentMode.createDefaultGenerationPlan();
}

/**
 * @return {void}
 */
async function bindIntermediateThoughts() {
    currentGenerationPlan.orphanIntermediateUnboundThoughts();
    await currentGenerationPlan.saveCharacterThoughts();
    await currentGenerationPlan.hideThoughts();

    currentGenerationPlan = currentMode.createDefaultGenerationPlan();
}

/**
 * @param {string} type
 * @return {Promise<void>}
 */
async function prepareGenerationPrompt(type) {
    if (getContext().groupId && !is_group_generating) {
        return;
    }

    await currentGenerationPlan.prepareGenerationPrompt(type);
}

/**
 * @param {string} generatedThought
 * @param {ThinkingPrompt} thinkingPrompt
 * @return {Promise<void>}
 */
async function putCharactersThoughts(generatedThought, thinkingPrompt) {
    const thinkingPromptSubstituted = Object.assign({}, thinkingPrompt);
    thinkingPromptSubstituted.name = substituteParams(thinkingPrompt.name);
    thinkingPromptSubstituted.prompt = substituteParams(thinkingPrompt.prompt);

    await currentGenerationPlan.putCharacterThoughts(generatedThought, thinkingPromptSubstituted);
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
    if (!isExtensionEnabled() || !isGenerationTypeAllowed(type) || isThinking) {
        return;
    }
    if (isThinkingSkipped(chatThinkingSettings.thinking_prompt_ids)) {
        await hideThoughts();
        return;
    }

    await runNewThoughtsGeneration($('#send_textarea'), chatThinkingSettings.thinking_prompt_ids);
    await generationDelay();
}

// core functions

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

    await bindIntermediateThoughts();

    releaseGeneration();
}

/**
 * @param {JQuery<HTMLTextAreaElement>} textarea
 * @param {?number[]} targetPromptIds
 * @return {Promise<void>}
 */
export async function runNewThoughtsGeneration(textarea, targetPromptIds = null) {
    if (!generationCaptured()) {
        return;
    }
    isThinking = true;

    try {
        await sendUserMessage(textarea);

        const templatePosition = await currentMode.sendCharacterTemplateMessage();
        currentGenerationPlan = currentMode.createNewThoughtsGenerationPlan(
            templatePosition,
            getCurrentCharacterPrompts(targetPromptIds),
            getContext().characterId
        );

        await currentGenerationPlan.hideThoughts();
        await generateThoughtsWithDisabledInput(textarea);
        await currentGenerationPlan.hideThoughts();
    } finally {
        isThinking = false;
        releaseGeneration();
    }
}

/**
 * @param {ThoughtPosition} targetThought
 * @return {Promise<void>}
 */
export async function runRefreshGeneratedThoughts(targetThought) {
    if (!generationCaptured()) {
        return;
    }
    isThinking = true;

    try {
        currentGenerationPlan = currentMode.createRefreshThoughtsGenerationPlan(targetThought);

        await currentGenerationPlan.hideThoughts();
        await generateThoughts();

        await currentGenerationPlan.saveCharacterThoughts();
    } finally {
        await currentGenerationPlan.hideThoughts();

        isThinking = false;
        currentGenerationPlan = currentMode.createDefaultGenerationPlan();
        releaseGeneration();
    }
}

/**
 * @param {JQuery<HTMLTextAreaElement>} textarea
 * @param {number[]} targetPromptIds
 * @return {Promise<void>}
 */
export async function runNewBoundThoughtsGeneration(textarea, targetPromptIds) {
    const context = getContext();

    if (!currentMode.isEmbeddedInMessages()) {
        await runNewThoughtsGeneration(textarea, targetPromptIds);
        return;
    }

    chatThinkingSettings = {
        is_enabled: true,
        thinking_prompt_ids: targetPromptIds,
    };
    Generate(null, { force_chid: context.characterId })
        .finally(() => chatThinkingSettings = {
            is_enabled: null,
            thinking_prompt_ids: null,
        });
}

/**
 * @param {string} characterName
 * @return {Promise<number>}
 */
export async function deleteHiddenThoughts(characterName) {
    return await currentMode.deleteHiddenThoughts(characterName.length > 0 ? characterName : null);
}

/**
 * @param {string} name
 * @return {void}
 */
export function switchMode(name) {
    currentMode = findMode(name);
    currentGenerationPlan = currentMode.createDefaultGenerationPlan();
}

/**
 * @param {?number} characterId
 * @return {?CharacterThinkingSettings}
 */
export function getCharacterSettings(characterId = null) {
    const context = getContext();
    const targetCharacterId = characterId !== null ? characterId : context.characterId;

    if (Number.isNaN(parseInt(targetCharacterId))) {
        return null;
    }

    const characterName = context.characters[targetCharacterId].name;
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
 * @return {Promise<void>}
 */
async function generateThoughtsWithDisabledInput(textarea) {
    sendTextareaOriginalPlaceholder = textarea.attr('placeholder');
    textarea.attr('placeholder', 'When a character is thinking, the input area is disabled');
    textarea.prop('readonly', true);
    textarea.val('')[0].dispatchEvent(new Event('input', { bubbles: true }));

    await generateThoughts().finally(() => {
        textarea.prop('readonly', false);
        textarea.attr('placeholder', sendTextareaOriginalPlaceholder);
        sendTextareaOriginalPlaceholder = null;
    });
}

/**
 * @return {Promise<void>}
 */
async function generateThoughts() {
    const context = getContext();

    if (settings.is_thinking_popups_enabled) {
        const toastThinkingMessage = context.substituteParams('{{char}} is thinking...');
        toastThinking = toastr.info(toastThinkingMessage, 'Stepped Thinking', { timeOut: 0, extendedTimeOut: 0 });
    }

    const prompts = currentGenerationPlan.getThinkingPrompts();
    for (let i = 0; i < prompts.length; i++) {
        if (prompts[i].prompt) {
            const generatedThought = await generateCharacterThought(prompts[i].prompt);
            await putCharactersThoughts(generatedThought, prompts[i]);

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
        settings.max_response_length,
        currentGenerationPlan.getCharacterId()
    );

    if (settings.regexp_to_sanitize.trim() !== '') {
        const regexp = context.substituteParams(settings.regexp_to_sanitize);
        result = result.replace(new RegExp(regexp, 'g'), '');
    }

    return result;
}

/**
 * @param {?number} characterId
 * @return {boolean}
 */
function isExtensionEnabled(characterId = null) {
    if (chatThinkingSettings.is_enabled !== null) {
        return chatThinkingSettings.is_enabled;
    }

    if (characterId !== null) {
        const characterSettings = getCharacterSettings(characterId);
        if (characterSettings && characterSettings.is_setting_enabled) {
            return characterSettings.is_thinking_enabled;
        }
    }

    return settings.is_enabled;
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
 * @param {number[]} targetPromptIds
 * @return {boolean}
 */
function isThinkingSkipped(targetPromptIds = null) {
    return !isExtensionEnabled(getContext().characterId)
        || getCurrentCharacterPrompts(targetPromptIds).length === 0;
}

/**
 * @param {number[]} targetPromptIds
 * @return {ThinkingPrompt[]}
 */
function getCurrentCharacterPrompts(targetPromptIds = null) {
    const characterSettings = getCharacterSettings();
    /** @var {function(ThinkingPrompt): boolean} */
    const filterEnabledOrTargetPrompts = prompt => {
        if (targetPromptIds !== null) {
            return targetPromptIds.includes(prompt.id);
        }
        return prompt.is_enabled !== false;
    };

    if (characterSettings) {
        const characterPrompts = characterSettings.thinking_prompts.filter(filterEnabledOrTargetPrompts);
        if (characterPrompts && characterPrompts.length > 0) {
            return characterPrompts;
        }
    }

    return settings.thinking_prompts.filter(filterEnabledOrTargetPrompts);
}
