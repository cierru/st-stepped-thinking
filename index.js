import { extension_settings, getContext } from '../../../extensions.js';
import {
    addOneMessage,
    chat,
    event_types,
    eventSource,
    extractMessageBias,
    removeMacros,
    saveChatConditional,
    saveSettingsDebounced,
    sendMessageAsUser,
    substituteParams,
    updateMessageBlock,
} from '../../../../script.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { hideChatMessageRange } from '../../../chats.js';
import { getMessageTimeStamp } from '../../../RossAscends-mods.js';

const extensionName = 'st-stepped-thinking';
const extensionFolder = `scripts/extensions/third-party/${extensionName}`;

export let settings = extension_settings[extensionName];

async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};

    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(
            extension_settings[extensionName],
            defaultCommonSettings,
            defaultThinkingPromptSettings,
            defaultSpecificCharactersSettings,
        );
    }
    settings = extension_settings[extensionName];

    loadCommonSettings();
    loadThinkingPromptSettings();
    loadSpecificCharacterSettings();
}

// settings - common

export const defaultCommonSettings = {
    'is_enabled': true,
    'is_wian_skipped': false,
    'is_thinking_popups_enabled': true,
    'is_thoughts_spoiler_open': false,
    'max_thoughts_in_prompt': 2,
    'generation_delay': 0.0,
    'max_response_length': 0,
    'regexp_to_sanitize': '(<\\/?details\\s?(type="executing")?>)|(<\\/?summary>)|(Thinking ({{char}}) 💭)|(```)',

    // Not in UI, since the settings are unlikely to be changed
    'thoughts_framing': '```',
    'thoughts_placeholder': 'st\n{{thoughts}}\n',
    'default_thoughts_substitution': '...',
    'thinking_summary_placeholder': 'Thinking ({{char}}) 💭',
    'max_hiding_thoughts_lookup': 200,
};

/**
 * @return {void}
 */
export function loadCommonSettings() {
    $('#stepthink_regexp_to_sanitize').val(settings.regexp_to_sanitize);
    $('#stepthink_max_thoughts_in_prompt').val(settings.max_thoughts_in_prompt);
    $('#stepthink_max_response_length').val(settings.max_response_length);
    $('#stepthink_generation_delay').val(settings.generation_delay);
    $('#stepthink_is_enabled').prop('checked', settings.is_enabled).trigger('input');
    $('#stepthink_is_wian_skipped').prop('checked', settings.is_wian_skipped).trigger('input');
    $('#stepthink_is_thoughts_spoiler_open').prop('checked', settings.is_thoughts_spoiler_open).trigger('input');
    $('#stepthink_is_thinking_popups_enabled').prop('checked', settings.is_thinking_popups_enabled).trigger('input');
}

/**
 * @return {void}
 */
export function registerCommonSettingListeners() {
    $('#stepthink_is_enabled').on('input', onCheckboxInput('is_enabled'));
    $('#stepthink_is_wian_skipped').on('input', onCheckboxInput('is_wian_skipped'));
    $('#stepthink_is_thoughts_spoiler_open').on('input', onCheckboxInput('is_thoughts_spoiler_open'));
    $('#stepthink_is_thinking_popups_enabled').on('input', onCheckboxInput('is_thinking_popups_enabled'));
    $('#stepthink_regexp_to_sanitize').on('input', onRegexpToSanitizeChanged);
    $('#stepthink_max_thoughts_in_prompt').on('input', onIntegerTextareaInput('max_thoughts_in_prompt'));
    $('#stepthink_max_response_length').on('input', onIntegerTextareaInput('max_response_length'));
    $('#stepthink_generation_delay').on('input', onGenerationDelayInput);

    $('#stepthink_additional_settings_toggle').on('click', () => $('#stepthink_additional_settings').slideToggle(200, 'swing'));
    $('#stepthink_restore_regexp_to_sanitize').on('click', () =>
        $('#stepthink_regexp_to_sanitize').val(defaultCommonSettings.regexp_to_sanitize).trigger('input')
    );
}

/**
 * @param {string} settingName
 * @return {(function(): void)}
 */
function onCheckboxInput(settingName) {
    return function () {
        settings[settingName] = Boolean($(this).prop('checked'));
        saveSettingsDebounced();
    };
}

/**
 * @param {string} settingName
 * @return {(function(): void)}
 */
function onIntegerTextareaInput(settingName) {
    return function () {
        const value = Number($(this).val());
        if (!Number.isInteger(value) || value < 0) {
            return;
        }

        settings[settingName] = value;
        saveSettingsDebounced();
    };
}

/**
 * @return {void}
 */
function onRegexpToSanitizeChanged() {
    settings.regexp_to_sanitize = $(this).val();
    saveSettingsDebounced();
}

/**
 * @return {void}
 */
function onGenerationDelayInput() {
    const value = parseFloat($(this).val());
    if (isNaN(value) || value < 0.0) {
        return;
    }

    settings.generation_delay = value;
    saveSettingsDebounced();
}

// settings - specific_characters

export const defaultSpecificCharactersSettings = {
    'excluded_characters': [],
    'mind_reader_characters': [],
};

/**
 * @return {void}
 */
export function loadSpecificCharacterSettings() {
    // don't need so far, it's here to preserve the structure of each settings file
}

/**
 * @return {void}
 */
export function registerSpecificCharacterListeners() {
    const excludedCharacters = $('#stepthink_excluded_characters');
    excludedCharacters.select2({
        width: '100%',
        placeholder: 'No characters chosen. Click here to select.',
        allowClear: true,
        closeOnSelect: false,
    });
    excludedCharacters.on('change', onSpecificCharactersChange('excluded_characters'));

    const mindReaderCharacters = $('#stepthink_mind_reader_characters');
    mindReaderCharacters.select2({
            width: '100%',
            placeholder: 'No characters chosen. Click here to select.',
            allowClear: true,
            closeOnSelect: false,
    });
    mindReaderCharacters.on('change', onSpecificCharactersChange('mind_reader_characters'));

    $('.stepthink_load_characters').on('click', onLoadCharacters);

    eventSource.on(event_types.APP_READY, onLoadCharacters);
}

/**
 * Excluded characters are identified by their names, because there are no reliable long-term ids for them in SillyTavern
 *
 * @return {void}
 */
function onLoadCharacters() {
    const excludedCharacters = $('#stepthink_excluded_characters');
    const mindReaderCharacters = $('#stepthink_mind_reader_characters');

    excludedCharacters.empty();
    mindReaderCharacters.empty();

    getContext().characters.forEach((character) => {
        excludedCharacters.append(createSpecificCharacterOption(character, settings.excluded_characters));
        mindReaderCharacters.append(createSpecificCharacterOption(character, settings.mind_reader_characters));
    });
}

/**
 * @param {v1CharData} character
 * @param {string[]} selections
 * @return {HTMLOptionElement}
 */
function createSpecificCharacterOption(character, selections = []) {
    const characterOption = document.createElement('option');
    characterOption.setAttribute('value', character.name);

    if (selections.includes(character.name)) {
        characterOption.selected = true;
    }
    characterOption.textContent = character.name;

    return characterOption;
}

/**
 * @param {string} settingName
 * @return {(function(*): void)}
 */
function onSpecificCharactersChange(settingName) {
    return function (event) {
        const selectedOptions = Array.from(event.target.selectedOptions);
        settings[settingName] = selectedOptions.map(selectedOption => selectedOption.value);
        saveSettingsDebounced();
    }
}

// settings - prompts

export const defaultThinkingPromptSettings = {
    'thinking_prompts': [{
        'id': 0,
        'prompt': 'Pause your roleplay. Describe {{char}}\'s thoughts at the current moment.\n' + '\n' +
            'Follow the next rules:\n' +
            '- Describe details in md-list format\n' +
            '- There should be 2-4 points\n' +
            '- Do not use any formatting constructions\n' + '\n' +
            'Example:\n' +
            '📍 Thoughts\n' +
            '- Adam looks at Eve so tenderly... I feel my chest constrict with jealousy.\n' +
            '"I know Adam loves me, but why does he spend so much time with Eve?"\n' +
            '- I want to ask Adam directly, but I am afraid to hear a lie.\n' +
            '- Maybe I am just too hypocritical?',
        'is_enabled': true,
    }, {
        'id': 1,
        'prompt': 'Pause your roleplay. Describe {{char}}\'s plans at the current moment.\n' + '\n' +
            'Follow the next rules:\n' +
            '- Describe details in ordered md-list format\n' +
            '- There should be 2-4 points\n' +
            '- Do not use any formatting constructions\n' + '\n' +
            'Example:\n' +
            '📍 Plans\n' +
            '1. Follow Eve and Adam\'s every move.\n' +
            '2. Look for an excuse to make a scene of jealousy.\n' +
            '3. Try to hurt Eve to make her lose her temper.\n' +
            '4. In the end, try to get Adam\'s attention back to myself.',
        'is_enabled': true,
    }],
};

/**
 * @return {void}
 */
export function loadThinkingPromptSettings() {
    settings.thinking_prompts.forEach((item) => {
        renderThinkingPromptAt(item.id, item?.prompt, item?.is_enabled);
    });
}

/**
 * @return {void}
 */
export function registerThinkingPromptListeners() {
    $('#stepthink_prompt_list_add').on('click', onPromptItemAdd);
}

/**
 * @param {number} id
 * @param {string} prompt
 * @param {boolean} is_enabled
 */
function renderThinkingPromptAt(id, prompt = '', is_enabled = true) {
    const textArea = document.createElement('textarea');
    textArea.setAttribute('id', 'stepthink_prompt_text--' + id);
    textArea.setAttribute('data-id', String(id));
    textArea.setAttribute('rows', '6');
    textArea.classList.add('text_pole', 'textarea_compact');
    if (prompt) {
        textArea.value = prompt;
    }
    textArea.addEventListener('input', onPromptItemInput);

    const buttonsContainer = document.createElement('div');
    buttonsContainer.classList.add('flex-container', 'alignItemsCenter', 'flexFlowColumn');

    const isEnabledButton = document.createElement('input');
    isEnabledButton.setAttribute('id', 'stepthink_prompt_enabled--' + id);
    isEnabledButton.setAttribute('data-id', String(id));
    isEnabledButton.setAttribute('type', 'checkbox');
    isEnabledButton.setAttribute('title', 'Enable prompt');
    if (is_enabled !== false) {
        isEnabledButton.setAttribute('checked', 'checked');
    }
    isEnabledButton.addEventListener('input', onPromptItemEnable);

    const removeButton = document.createElement('div');
    removeButton.setAttribute('id', 'stepthink_prompt_remove--' + id);
    removeButton.setAttribute('data-id', String(id));
    removeButton.setAttribute('title', 'Remove prompt');
    removeButton.classList.add('menu_button', 'menu_button_icon', 'fa-solid', 'fa-trash', 'redWarningBG');
    removeButton.addEventListener('click', onPromptItemRemove);

    buttonsContainer.append(isEnabledButton, removeButton);

    const listItem = document.createElement('div');
    listItem.setAttribute('id', 'stepthink_prompt_item--' + id);
    listItem.classList.add('flex-container', 'marginTopBot5', 'alignItemsCenter');

    listItem.append(textArea, buttonsContainer);

    $('#stepthink_prompt_list').append(listItem);
}

/**
 * @return {void}
 */
function onPromptItemAdd() {
    const promptsCount = settings.thinking_prompts.length;
    const id = promptsCount > 0 ? settings.thinking_prompts[promptsCount - 1].id + 1 : 0;

    renderThinkingPromptAt(id);

    settings.thinking_prompts.push({ 'id': id, 'prompt': prompt });
    saveSettingsDebounced();
}

/**
 * @param {InputEvent} event
 */
function onPromptItemInput(event) {
    const id = Number(event.target.getAttribute('data-id'));

    const value = $('#stepthink_prompt_text--' + id).val();
    const changedPrompt = settings.thinking_prompts.find(item => item.id === id);
    changedPrompt.prompt = value;
    saveSettingsDebounced();
}


/**
 * @param {InputEvent} event
 */
function onPromptItemEnable(event) {
    const id = Number(event.target.getAttribute('data-id'));

    const value = $('#stepthink_prompt_enabled--' + id).prop('checked');
    const changedPrompt = settings.thinking_prompts.find(item => item.id === id);
    changedPrompt.is_enabled = value;
    saveSettingsDebounced();
}

/**
 * @param {PointerEvent} event
 */
function onPromptItemRemove(event) {
    console.log('onPromptItemRemove', event);
    const id = Number(event.target.getAttribute('data-id'));

    $('#stepthink_prompt_item--' + id).remove();

    settings.thinking_prompts = settings.thinking_prompts.filter(item => item.id !== id);
    saveSettingsDebounced();
}

// generation

let generationType;
let isGenerationStopped = false; // this is a crutch to avoid looping in group chats

/**
 * There is a hidden dependency between the events: GENERATION_AFTER_COMMANDS and GROUP_MEMBER_DRAFTED.
 * The second one fires only in group chats, as it follows from the name, and since it is aware of a character id
 * that has been chosen for generation, it is more suitable for launching the thinking process. However,
 * GENERATION_AFTER_COMMANDS is still required to retrieve and pass some important information about the Generate call.
 *
 * @return {void}
 */
export function registerGenerationEventListeners() {
    eventSource.on(event_types.GENERATION_STOPPED, onGenerationStopped);
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, onGenerationAfterCommands);
    eventSource.on(event_types.GROUP_MEMBER_DRAFTED, onGroupMemberDrafted);
}

/**
 * @param {string} type
 * @returns {Promise<void>}
 */
async function onGenerationAfterCommands(type) {
    generationType = type;
    isGenerationStopped = false;

    if (getContext().groupId) {
        return;
    }
    if (generationType) {
        return;
    }

    await runChatThinking();

}

/**
 * @returns {Promise<void>}
 */
async function onGroupMemberDrafted() {
    if (isGenerationStopped) {
        return;
    }
    if (generationType && generationType !== 'normal' && generationType !== 'group_chat') {
        return;
    }

    await runChatThinking();
}

/**
 * @returns {Promise<void>}
 */
async function onGenerationStopped() {
    isGenerationStopped = true;
    stopThinking($('#send_textarea'));
}

/**
 * @returns {Promise<void>}
 */
async function runChatThinking() {
    if (isThinking || !settings.is_enabled) {
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
 * @return {boolean}
 */
function isThinkingSkipped() {
    const context = getContext();
    return settings.excluded_characters.includes(context.characters[context.characterId].name)
        || settings.thinking_prompts.find(item => item.is_enabled !== false) === undefined;
}

// thinking

let isThinking = false;
let toastThinking, sendTextareaOriginalPlaceholder;

/**
 * @param {JQuery<HTMLTextAreaElement>} textarea
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
}

/**
 * @param {JQuery<HTMLTextAreaElement>} textarea
 * @returns {Promise<void>}
 */
export async function runThinking(textarea) {
    isThinking = true;

    try {
        await sendUserMessage(textarea);

        await hideThoughts();
        await generateThoughtsWithDisabledInput(textarea);

        await hideThoughts();
    } finally {
        isThinking = false;
    }
}

/**
 * @param {JQuery<HTMLTextAreaElement>} textarea
 * @returns {Promise<void>}
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
 * @returns {Promise<void>}
 */
async function hideThoughts() {
    const context = getContext();
    const maxThoughts = settings.max_thoughts_in_prompt;

    const currentCharacter = context.characters[context.characterId];
    const isMindReaderCharacter = settings.mind_reader_characters.includes(currentCharacter.name);
    const hasAccessToThought = (chatCharacter) => isMindReaderCharacter || chatCharacter.name === currentCharacter.name;

    let promises = [];
    const lastMessageIndex = context.chat.length - 1;
    for (let i = lastMessageIndex, thoughtsCount = []; lastMessageIndex - i < settings.max_hiding_thoughts_lookup; i--) {
        if (Boolean(context.chat[i]?.is_thoughts)) {
            const chatCharacter = context.chat[i];
            thoughtsCount[chatCharacter.name] ??= 0;

            if (thoughtsCount[chatCharacter.name] < maxThoughts && hasAccessToThought(chatCharacter)) {
                promises.push(hideChatMessageRange(i, i, true));
            } else {
                promises.push(hideChatMessageRange(i, i, false));
            }

            thoughtsCount[chatCharacter.name]++;
        }
    }

    await Promise.all(promises);
}

/**
 * The Generate function sends input from #send_textarea before starting generation. Since the user probably doesn't
 * want their input to be suddenly sent when the character finishes thinking, the input field is disabled during the process
 *
 * @param {JQuery<HTMLTextAreaElement>} textarea
 * @returns {Promise<void>}
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
 * @returns {Promise<void>}
 */
async function generateThoughts() {
    const context = getContext();
    const characterThoughtsPosition = await sendCharacterTemplateMessage();

    if (settings.is_thinking_popups_enabled) {
        const toastThinkingMessage = context.substituteParams('{{char}} is thinking...');
        toastThinking = toastr.info(toastThinkingMessage, 'Stepped Thinking', { timeOut: 0, extendedTimeOut: 0 });
    }

    const prompts = settings.thinking_prompts.filter(item => item.is_enabled !== false);
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
 * @returns {Promise<number>}
 */
async function sendCharacterTemplateMessage() {
    const context = getContext();
    const openState = settings.is_thoughts_spoiler_open ? 'open' : '';

    return await sendCharacterThoughts(
        context.characters[context.characterId],
        '<details type="executing" ' + openState + '><summary>' +
        settings.thinking_summary_placeholder +
        '</summary>' + '\n' +
        replaceThoughtsPlaceholder(settings.default_thoughts_substitution) + '\n'
        + '</details>',
    );
}

/**
 * @param {string} prompt
 * @returns {Promise<string>}
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
 * @returns {Promise<void>}
 */
async function insertCharacterThoughtsAt(position, thoughts) {
    const context = getContext();
    if (!context.chat[position]) {
        toastr.error('The message was not found at position ' + position + ', cannot insert thoughts. ' + 'Probably, the error was caused by unexpected changes in the chat.', 'Stepped Thinking', { timeOut: 10000 });
        return;
    }
    const message = context.chat[position];
    const defaultPlaceholder = replaceThoughtsPlaceholder(settings.default_thoughts_substitution);

    if (message.mes.search(defaultPlaceholder) !== -1) {
        message.mes = message.mes.replace(defaultPlaceholder, replaceThoughtsPlaceholder(thoughts));
    } else {
        const lastThoughtLastIndex = message.mes.lastIndexOf(settings.thoughts_framing) + settings.thoughts_framing.length;
        message.mes = message.mes.substring(0, lastThoughtLastIndex) + '\n' + replaceThoughtsPlaceholder(thoughts) + message.mes.substring(lastThoughtLastIndex);
    }

    updateMessageBlock(position, message);

    await context.saveChat();
}

/**
 * @param {object} character
 * @param {string} text
 * @returns {Promise<number>}
 */
async function sendCharacterThoughts(character, text) {
    let mesText;

    mesText = text.trim();

    const bias = extractMessageBias(mesText);
    const isSystem = bias && !removeMacros(mesText).length;

    const message = {
        name: character.name,
        is_user: false,
        is_system: isSystem,
        is_thoughts: true,
        send_date: getMessageTimeStamp(),
        mes: substituteParams(mesText),
        extra: {
            bias: bias.trim().length ? bias : null,
            gen_id: Date.now(),
            isSmallSys: false,
            api: 'script',
            model: 'stepped executing',
        },
    };

    message.swipe_id = 0;
    message.swipes = [message.mes];
    message.swipes_info = [{
        send_date: message.send_date, gen_started: null, gen_finished: null, extra: {
            bias: message.extra.bias,
            gen_id: message.extra.gen_id,
            isSmallSys: false,
            api: 'script',
            model: 'stepped executing',
        },
    }];

    const context = getContext();
    if (context.groupId) {
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
 * @returns {string}
 */
function replaceThoughtsPlaceholder(substitution) {
    const thoughtsPlaceholder = settings.thoughts_framing + settings.thoughts_placeholder + settings.thoughts_framing;
    return thoughtsPlaceholder.replace('{{thoughts}}', substitution);
}

/**
 * @return {Promise<void>}
 */
async function generationDelay() {
    if (settings.generation_delay > 0.0) {
        console.log('Delaying generation for', settings.generation_delay, 'seconds');
        await new Promise((resolve) => setTimeout(resolve, settings.generation_delay * 1000));
        console.log('Generation delay complete');
    }
}

//

SlashCommandParser.addCommandObject(SlashCommand.fromProps({
	name: 'steppedthinking-trigger',
	callback: async () => {
		await runThinking($('#send_textarea'));
	},
	helpString: 'Trigger Stepped Thinking via command/QR[Only 1 on 1 chats].',
}));

jQuery(async () => {
    const settingsHtml = await $.get(`${extensionFolder}/settings.html`);

    $('#extensions_settings').append(settingsHtml);

    registerCommonSettingListeners();
    registerThinkingPromptListeners();
    registerSpecificCharacterListeners();

    registerGenerationEventListeners();

    loadSettings();
});
