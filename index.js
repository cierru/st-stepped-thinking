import { getContext } from '../../../extensions.js';
import {
    event_types,
    eventSource,
    reloadCurrentChat,
    saveChatConditional,
    setCharacterId,
    setCharacterName,
} from '../../../../script.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import {
    renderInitialThoughts,
    renderThoughts,
    runChatThinking,
    runThinking,
    saveThoughts,
    stopThinking,
} from './thinking/engine.js';
import {
    ARGUMENT_TYPE,
    SlashCommandArgument,
    SlashCommandNamedArgument,
} from '../../../slash-commands/SlashCommandArgument.js';
import { commonEnumProviders } from '../../../slash-commands/SlashCommandCommonEnumsProvider.js';
import { is_group_generating } from '../../../group-chats.js';
import { registerGenerationMutexListeners } from './interconnection.js';
import {
    loadSettings,
    registerSettingsListeners,
    addSettingsUI,
} from './settings/settings.js';
import { registerThinkingListeners } from './thinking/strategy.js';

export const extensionName = 'st-stepped-thinking';
const extensionFolder = `scripts/extensions/third-party/${extensionName}`;

// generation

/**
 * @return {void}
 */
export function registerGenerationEventListeners() {
    eventSource.on(event_types.GENERATION_STOPPED, onGenerationStopped);
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, onGenerationAfterCommands);

    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(event_types.MESSAGE_DELETED, onMessageDeleted);
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    $(document).on('mouseup touchend', '#show_more_messages', onShowMoreMessagesClicked);
}

/**
 * @param {string} type
 * @returns {Promise<void>}
 */
async function onGenerationAfterCommands(type) {
    if (getContext().groupId) {
        if (!is_group_generating) {
            return;
        }
        if (type !== 'normal' && type !== 'group_chat') {
            return;
        }
    } else {
        if (type) {
            return;
        }
    }

    await runChatThinking($('#send_textarea'));
}

/**
 * @return {Promise<void>}
 */
async function onChatChanged() {
    await renderInitialThoughts();
}

/**
 * @return {Promise<void>}
 */
async function onShowMoreMessagesClicked() {
    await renderThoughts();
}

/**
 * @return {Promise<void>}
 */
async function onMessageReceived() {
    await saveThoughts('last', getContext().chat.length - 1);
}

/**
 * @return {Promise<void>}
 */
async function onMessageDeleted() {
    await renderThoughts();
}

/**
 * @returns {Promise<void>}
 */
async function onGenerationStopped() {
    await stopThinking($('#send_textarea'));
}

// slash-commands

/**
 * @param {object} input
 * @param {?string} name
 * @return {Promise<string>}
 */
async function runThinkingCommand(input, name = '') {
    const context = getContext();

    // TODO: implement a popup to select a character
    if (context.groupId && !name && !Number.isInteger(Number(context.characterId))) {
        throw new Error('Unknown character to generate thoughts. Please, specify one with passing the name argument');
    }
    if (name) {
        const characterIndex = context.characters.findIndex(character => character.name === name);
        if (characterIndex === -1) {
            throw new Error('A character with the specified name is not found');
        }

        setCharacterId(characterIndex);
        setCharacterName(name);
    }

    let targetPromptIds = input.prompt_ids ? input.prompt_ids.split(',') : null;

    try {
        // TODO saveThoughts
        await runThinking($('#send_textarea'), targetPromptIds);
    } catch (error) {
        // For some reason, the characterId and characterName are reset after the first thinking prompt generation in the context
        // which leads to throwing an error. I have no desire to untie the generation spaghetti to figure out how to
        // prevent this behavior or add ugly crutches, taking into consideration that it actually WORKS even despite the errors
        console.error('[Stepped Thinking] An error occurred during running thinking process', error);
    }

    return '';
}

SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'stepthink-trigger',
    callback: runThinkingCommand,
    unnamedArgumentList: [
        SlashCommandArgument.fromProps({
            description: 'character name',
            typeList: [ARGUMENT_TYPE.STRING],
            isRequired: false,
            enumProvider: commonEnumProviders.groupMembers,
        }),
    ],
    namedArgumentList: [
        SlashCommandNamedArgument.fromProps({
            name: 'prompt_ids',
            description: 'comma-separated prompt ids, e.g., prompt_ids=1,2',
            typeList: [ARGUMENT_TYPE.STRING],
            isRequired: false,
        }),
    ],
    helpString: 'Trigger Stepped Thinking.',
}));

/**
 * @param {object} _
 * @param {?string} name
 * @return {Promise<string>}
 */
async function deleteHiddenThoughts(_, name = '') {
    const context = getContext();
    const messagesToDelete = [];

    context.chat.forEach(message => {
        if (message.is_thoughts && message.is_system && (!name || message.name === name)) {
            messagesToDelete.push(message);
        }
    });

    for (const message of messagesToDelete) {
        const index = context.chat.indexOf(message);
        if (index !== -1) {
            console.debug(`[Stepped Thinking] Deleting thoughts at #${index}`, message);
            context.chat.splice(index, 1);
        }
    }

    await saveChatConditional();
    await reloadCurrentChat();

    const deletionResultInfo = `Deleted ${messagesToDelete.length} thoughts`;
    toastr.info(name ? deletionResultInfo + ` from ${name}` : deletionResultInfo, 'Stepped Thinking');

    return '';
}

SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'stepthink-delete-hidden',
    callback: deleteHiddenThoughts,
    unnamedArgumentList: [
        SlashCommandArgument.fromProps({
            description: 'character name',
            typeList: [ARGUMENT_TYPE.STRING],
            isRequired: false,
            enumProvider: commonEnumProviders.groupMembers,
        }),
    ],
    helpString: 'Delete hidden thoughts.',
}));

jQuery(async () => {
    const settingsHtml = await $.get(`${extensionFolder}/settings/settings.html`);

    $('#extensions_settings').append(settingsHtml);

    await loadSettings();

    addSettingsUI();
    registerSettingsListeners();

    registerThinkingListeners();

    registerGenerationMutexListeners();
    registerGenerationEventListeners();
});
