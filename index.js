import { getContext } from '../../../extensions.js';
import {
    setCharacterId,
    setCharacterName,
} from '../../../../script.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import {
    deleteHiddenThoughts,
    registerGenerationEventListeners,
    runNewBoundThoughtsGeneration,
} from './thinking/engine.js';
import {
    ARGUMENT_TYPE,
    SlashCommandArgument,
    SlashCommandNamedArgument,
} from '../../../slash-commands/SlashCommandArgument.js';
import { commonEnumProviders } from '../../../slash-commands/SlashCommandCommonEnumsProvider.js';
import { registerGenerationMutexListeners } from './interconnection.js';
import {
    loadSettings,
    registerSettingsListeners,
    addSettingsUI,
} from './settings/settings.js';

export const extensionName = 'st-stepped-thinking';
const extensionFolder = `scripts/extensions/third-party/${extensionName}`;

// slash-commands

/**
 * @param {object} input
 * @param {?string} name
 * @return {Promise<string>}
 */
async function runThinkingCommand(input, name = '') {
    const context = getContext();

    // TODO: implement a popup to select a character
    if (!name && Number.isNaN(parseInt(context. characterId))) {
        throw new Error('Unknown character to generate thoughts. Please, specify one with passing the name argument');
    }
    if (name) {
        const characterId = context.characters.findIndex(character => character.name === name);
        if (characterId === -1) {
            throw new Error('A character with the specified name is not found');
        }

        setCharacterId(characterId);
        setCharacterName(name);
    }

    let targetPromptIds = input.prompt_ids ? input.prompt_ids.split(',').map(id => Number(id)) : null;

    await runNewBoundThoughtsGeneration($('#send_textarea'), targetPromptIds).catch(error => {
        // For some reason, the characterId and characterName are reset after the first thinking prompt generation in the context
        // which leads to throwing an error. I have no desire to untie the generation spaghetti to figure out how to
        // prevent this behavior or add ugly crutches, taking into consideration that it actually WORKS even despite the errors
        console.error('[Stepped Thinking] An error occurred during running thinking process', error);
    });

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
async function deleteHiddenThoughtsCommand(_, name = '') {
    const numRemovedMessages = await deleteHiddenThoughts(name);

    const deletionResultInfo = `Deleted ${numRemovedMessages} thoughts`;
    toastr.info(name ? deletionResultInfo + ` from ${name}` : deletionResultInfo, 'Stepped Thinking');

    return '';
}

SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'stepthink-delete-hidden',
    callback: deleteHiddenThoughtsCommand,
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

    registerGenerationMutexListeners();
    registerGenerationEventListeners();
});
