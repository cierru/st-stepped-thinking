import { extensionName } from '../index.js';
import { event_types, eventSource, saveSettingsDebounced } from '../../../../../script.js';
import { select2ChoiceClickSubscribe } from '../../../../utils.js';
import { getCurrentCharacterSettings } from '../thinking/engine.js';
import { extension_settings, getContext, renderExtensionTemplateAsync } from '../../../../extensions.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../popup.js';
import { switchToEmbeddedThoughts, switchToSeparatedThoughts } from '../thinking/strategy.js';

export let settings;

export const defaultSettings = () => Object.assign({},
    defaultCommonSettings,
    defaultThinkingPromptSettings,
    defaultCharactersSettings,
);

/**
 * @return {void}
 */
export function addSettingsUI() {
    addCharacterSettingMenuButton();
}

/**
 * @return {void}
 */
export function registerSettingsListeners() {
    registerCommonSettingListeners();
    registerCharacterSettingsListeners();
    registerThinkingPromptListeners();
}

/**
 * @return {Promise<void>}
 */
export async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    setDefaultsForUndefined(extension_settings[extensionName]);

    settings = extension_settings[extensionName];

    migrateSettingsV2(settings);

    loadCommonSettings();
    loadThinkingPromptSettings();
    loadCharacterSettings();

    switchToEmbeddedThoughts();
}

/**
 * @param {object} settings
 */
function setDefaultsForUndefined(settings) {
    const defaults = defaultSettings();

    for (const settingKey in defaults) {
        if (settings[settingKey] === undefined) {
            settings[settingKey] = defaults[settingKey];
        }
    }
}

/**
 * This is a temporary function that will be removed in v3
 *
 * @param {object} settings
 */
function migrateSettingsV2(settings) {
    if (typeof settings.thoughts_placeholder === 'string') {
        settings.thoughts_placeholder = defaultCommonSettings.thoughts_placeholder;
    }
}

// settings - common

const defaultCommonSettings = {
    'is_enabled': true,
    'is_wian_skipped': false,
    'is_thinking_popups_enabled': true,
    'is_thoughts_spoiler_open': false,
    'is_thoughts_as_system': false,
    'max_thoughts_in_prompt': 2,
    'generation_delay': 0.0,
    'max_response_length': 0,
    'regexp_to_sanitize': '(<\\/?details\\s?(type="executing")?>)|(<\\/?summary>)|(Thinking ({{char}}) 💭)|(```)',
    'max_hiding_thoughts_lookup': 1000,
    'system_character_name_template': '{{char}}\'s Thoughts',
    'thoughts_message_template': '<details type="executing" {{thoughts_spoiler_open_state}}><summary>Thinking ({{char}}) 💭</summary>\n' +
        '{{thoughts_placeholder}}\n' +
        '</details>',
    'thoughts_placeholder': {
        'start': '```md',
        'content': '\n{{thoughts}}\n',
        'default_content': '...',
        'end': '```',
    },
};

/**
 * @return {void}
 */
function loadCommonSettings() {
    $('#stepthink_regexp_to_sanitize').val(settings.regexp_to_sanitize);
    $('#stepthink_system_character_name_template').val(settings.system_character_name_template);
    $('#stepthink_thoughts_message_template').val(settings.thoughts_message_template);
    $('#stepthink_max_thoughts_in_prompt').val(settings.max_thoughts_in_prompt);
    $('#stepthink_max_response_length').val(settings.max_response_length);
    $('#stepthink_generation_delay').val(settings.generation_delay);
    $('#stepthink_max_hiding_thoughts_lookup').val(settings.max_hiding_thoughts_lookup);
    $('#stepthink_is_enabled').prop('checked', settings.is_enabled).trigger('input');
    $('#stepthink_is_wian_skipped').prop('checked', settings.is_wian_skipped).trigger('input');
    $('#stepthink_is_thoughts_spoiler_open').prop('checked', settings.is_thoughts_spoiler_open).trigger('input');
    $('#stepthink_is_thinking_popups_enabled').prop('checked', settings.is_thinking_popups_enabled).trigger('input');
    $('#stepthink_is_thoughts_as_system').prop('checked', settings.is_thoughts_as_system).trigger('input');

    $('#stepthink_thoughts_placeholder_start').val(settings.thoughts_placeholder.start);
    $('#stepthink_thoughts_placeholder_content').val(settings.thoughts_placeholder.content);
    $('#stepthink_thoughts_placeholder_default_content').val(settings.thoughts_placeholder.default_content);
    $('#stepthink_thoughts_placeholder_end').val(settings.thoughts_placeholder.end);
}

/**
 * @return {void}
 */
function registerCommonSettingListeners() {
    $('#stepthink_is_enabled').on('input', onCheckboxInput('is_enabled'));
    $('#stepthink_is_wian_skipped').on('input', onCheckboxInput('is_wian_skipped'));
    $('#stepthink_is_thoughts_spoiler_open').on('input', onCheckboxInput('is_thoughts_spoiler_open'));
    $('#stepthink_is_thinking_popups_enabled').on('input', onCheckboxInput('is_thinking_popups_enabled'));
    $('#stepthink_is_thoughts_as_system').on('input', onCheckboxInput('is_thoughts_as_system'));
    $('#stepthink_regexp_to_sanitize').on('input', onTextareaInput('regexp_to_sanitize'));
    $('#stepthink_system_character_name_template').on('input', onTextareaInput('system_character_name_template'));
    $('#stepthink_thoughts_message_template').on('input', onTextareaInput('thoughts_message_template'));
    $('#stepthink_max_thoughts_in_prompt').on('input', onIntegerTextareaInput('max_thoughts_in_prompt'));
    $('#stepthink_max_response_length').on('input', onIntegerTextareaInput('max_response_length'));
    $('#stepthink_generation_delay').on('input', onGenerationDelayInput);
    $('#stepthink_max_hiding_thoughts_lookup').on('input', onIntegerTextareaInput('max_hiding_thoughts_lookup'));

    $('#stepthink_thoughts_placeholder_start').on('input', onTextareaInput('thoughts_placeholder', 'start'));
    $('#stepthink_thoughts_placeholder_content').on('input', onTextareaInput('thoughts_placeholder', 'content'));
    $('#stepthink_thoughts_placeholder_default_content').on('input', onTextareaInput('thoughts_placeholder', 'default_content'));
    $('#stepthink_thoughts_placeholder_end').on('input', onTextareaInput('thoughts_placeholder', 'end'));

    $('#stepthink_additional_settings_toggle').on('click', () => $('#stepthink_additional_settings').slideToggle(200, 'swing'));

    $('#stepthink_restore_regexp_to_sanitize').on('click', () =>
        $('#stepthink_regexp_to_sanitize').val(defaultCommonSettings.regexp_to_sanitize).trigger('input')
    );
    $('#stepthink_restore_thoughts_message_template').on('click', () =>
        $('#stepthink_thoughts_message_template').val(defaultCommonSettings.thoughts_message_template).trigger('input')
    );
    $('#stepthink_restore_thoughts_placeholder').on('click', () => {
            $('#stepthink_thoughts_placeholder_start').val(defaultCommonSettings.thoughts_placeholder.start).trigger('input');
            $('#stepthink_thoughts_placeholder_content').val(defaultCommonSettings.thoughts_placeholder.content).trigger('input');
            $('#stepthink_thoughts_placeholder_default_content').val(defaultCommonSettings.thoughts_placeholder.default_content).trigger('input');
            $('#stepthink_thoughts_placeholder_end').val(defaultCommonSettings.thoughts_placeholder.end).trigger('input');
        },
    );
}

/**
 * @param {string} settingName
 * @param {?object} settingBase
 * @return {(function(): void)}
 */
function onCheckboxInput(settingName, settingBase = null) {
    return function () {
        const value = Boolean($(this).prop('checked'));

        if (settingBase) {
            settingBase[settingName] = value;
        } else {
            settings[settingName] = value;
        }

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
 * @param {string[]} settingNames
 * @return {(function(): void)}
 */
function onTextareaInput(...settingNames) {
    return function () {
        const lastSettingId = settingNames.length - 1;
        const lastSetting = settingNames[lastSettingId];

        let subSettings = settings;
        for (let i = 0; i < lastSettingId; i++) {
            subSettings = subSettings[settingNames[i]];
        }

        subSettings[lastSetting] = $(this).val();
        saveSettingsDebounced();
    };
}

/**
 * @return {void}
 */
function onGenerationDelayInput() {
    const value = Number($(this).val());
    if (Number.isNaN(value) || value < 0.0) {
        return;
    }

    settings.generation_delay = value;
    saveSettingsDebounced();
}

// settings - character_settings

/**
 * A character's settings are identified by their name, because there are no reliable long-term ids for them in SillyTavern except for avatars
 *
 * @typedef {object} CharacterThinkingSettings
 * @property {string} name - the name of the character
 * @property {boolean} is_setting_enabled - whether this set of options will be applied or not
 * @property {boolean} is_thinking_enabled - whether the thinking process will be run for the character or not
 * @property {boolean} is_mind_reader - whether the character can read the other characters' thoughts or not
 * @property {ThinkingPrompt[]} thinking_prompts - a unique set of thinking prompts that will be used by the character
 */

/**
 * @type {{character_settings: CharacterThinkingSettings[]}}
 */
const defaultCharactersSettings = {
    'character_settings': [],
};

/**
 * @return {void}
 */
function loadCharacterSettings() {
    // don't need so far, it's here to preserve the structure of each settings file
}

/**
 * @return {void}
 */
function registerCharacterSettingsListeners() {
    const characterSettings = $('#stepthink_character_settings');
    characterSettings.select2({
        width: '100%',
        placeholder: 'No characters chosen. Click here to select.',
        allowClear: true,
        closeOnSelect: false,
    });
    select2ChoiceClickSubscribe(characterSettings, onCharacterSettingClicked, { buttonStyle: true, closeDrawer: true });

    characterSettings.on('select2:unselect', onCharacterUnselected);
    characterSettings.on('select2:select', onCharacterSelected);

    $('#stepthink_load_characters').on('click', onLoadCharacters);

    eventSource.on(event_types.APP_READY, onLoadCharacters);
}

/**
 * @return {void}
 */
function addCharacterSettingMenuButton() {
    const characterMenuButton = document.createElement('div');
    characterMenuButton.setAttribute('id', 'stepthink_character_setting_menu_button');
    characterMenuButton.setAttribute('title', 'Setup Stepped Thinking');
    characterMenuButton.classList.add('menu_button', 'fa-solid', 'fa-comment', 'interactable');
    characterMenuButton.addEventListener('click', onCharacterSettingMenuButtonClick);

    watchButtonVisibility(characterMenuButton);

    $('.form_create_bottom_buttons_block').prepend(characterMenuButton);
}

/**
 * This is a workaround to highlight the button when the right navigation panel displays a new character.
 * The workaround may be removed once an event triggered by the select_selected_character function is implemented
 * or something like this
 *
 * @param {Element} characterMenuButton
 * @return {void}
 */
function watchButtonVisibility(characterMenuButton) {
    const intersectionObserver = new IntersectionObserver(entries => {
        const characterMenuButtonEntity = entries[0];
        if (characterMenuButtonEntity.isIntersecting) {
            toggleCharacterMenuButtonHighlight(characterMenuButtonEntity.target);
        }
    });

    intersectionObserver.observe(characterMenuButton);
}

/**
 * @param {Element} characterMenuButton
 * @return {void}
 */
function toggleCharacterMenuButtonHighlight(characterMenuButton) {
    if (getCurrentCharacterSettings()?.is_setting_enabled) {
        characterMenuButton.classList.add('toggleEnabled');
    } else {
        characterMenuButton.classList.remove('toggleEnabled');
    }
}

/**
 * @return {Promise<void>}
 */
async function onCharacterSettingMenuButtonClick() {
    const context = getContext();
    const characterName = context.characters[context.characterId].name;

    await showCharacterSettingsPopup(characterName);
}

/**
 * @param {object} event
 * @return {Promise<void>}
 */
async function onCharacterSettingClicked(event) {
    const characterName = event.textContent;
    await showCharacterSettingsPopup(characterName);
}

/**
 * @param {string} characterName
 * @return {(function(*): void)}
 */
function resolveCharacterSelectionPopup(characterName) {
    return (is_setting_enabled) => {
        if (is_setting_enabled === 1) {
            selectCharacter(characterName);
        } else {
            unselectCharacter(characterName);
        }

        $('#stepthink_load_characters').trigger('click');
    };
}

/**
 *
 * @param {string} characterName
 * @return {Promise<void>}
 */
async function showCharacterSettingsPopup(characterName) {
    const shortName = characterName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const setting = selectCharacter(characterName);

    const template = await renderExtensionTemplateAsync(
        `third-party/${extensionName}/settings`,
        'character-settings',
        {
            character_name: characterName,
            short_name: shortName,
        },
    );

    const popup = callGenericPopup(template, POPUP_TYPE.TEXT, '', { okButton: 'Activate', cancelButton: 'Deactivate' });
    popup.then(resolveCharacterSelectionPopup(characterName));

    $(`#stepthink_character_settings--${shortName}`).ready(onCharacterSettingReady(shortName, setting));

    $(`#stepthink_is_thinking_enabled--${shortName}`).on('input', onCheckboxInput('is_thinking_enabled', setting));
    $(`#stepthink_is_mind_reader--${shortName}`).on('input', onCheckboxInput('is_mind_reader', setting));

    $(`#stepthink_prompt_list_add--${shortName}`).on('click', onPromptItemAdd({
        owner: shortName,
        prompts_element: $(`#stepthink_prompt_list--${shortName}`),
        prompts_settings: setting.thinking_prompts,
    }));
}

/**
 * @param {string} shortName
 * @param {CharacterThinkingSettings} setting
 * @return {(function(): void)}
 */
function onCharacterSettingReady(shortName, setting) {
    return function () {
        const list = $(`#stepthink_prompt_list--${shortName}`);

        $(`#stepthink_is_thinking_enabled--${shortName}`).prop('checked', setting.is_thinking_enabled);
        $(`#stepthink_is_mind_reader--${shortName}`).prop('checked', setting.is_mind_reader);

        setting.thinking_prompts.forEach(prompt => {
            renderThinkingPromptAt(
                prompt.id,
                {
                    owner: shortName,
                    prompts_element: list,
                    prompts_settings: setting.thinking_prompts,
                },
            );
        });
    };
}

/**
 * @param {object} event
 * @return {void}
 */
async function onCharacterSelected(event) {
    const characterName = event.params.data.id;

    selectCharacter(characterName);
    await showCharacterSettingsPopup(characterName);
}

/**
 * @param {string} characterName
 * @return {CharacterThinkingSettings}
 */
function selectCharacter(characterName) {
    settings.character_settings ??= [];

    let setting = settings.character_settings.find(setting => setting.name === characterName);
    if (!setting) {
        setting = {
            name: characterName,
            is_setting_enabled: true,
            is_thinking_enabled: true,
            is_mind_reader: false,
            thinking_prompts: [],
        };
        settings.character_settings.push(setting);
    } else {
        setting.is_setting_enabled = true;
    }

    toggleCharacterMenuButtonHighlight(document.getElementById('stepthink_character_setting_menu_button'));
    saveSettingsDebounced();

    return setting;
}

/**
 * @param {object} event
 * @return {void}
 */
function onCharacterUnselected(event) {
    const characterName = event.params.data.id;
    unselectCharacter(characterName);
}

/**
 * @param {string} characterName
 * @return {void}
 */
function unselectCharacter(characterName) {
    const setting = settings.character_settings.find(setting => setting.name === characterName);
    setting.is_setting_enabled = false;

    toggleCharacterMenuButtonHighlight(document.getElementById('stepthink_character_setting_menu_button'));
    saveSettingsDebounced();
}

/**
 * @return {void}
 */
function onLoadCharacters() {
    const characterSettings = $('#stepthink_character_settings');
    characterSettings.empty();

    getContext().characters.forEach(character => {
        const characterOption = document.createElement('option');
        characterOption.setAttribute('value', character.name);

        if (settings.character_settings?.find(setting => setting.name === character.name && setting.is_setting_enabled)) {
            characterOption.selected = true;
        }
        characterOption.textContent = character.name;

        characterSettings.append(characterOption);
    });
}

// settings - prompts

/**
 * @typedef {object} ThinkingPrompt
 * @property {number} id - synthetic key
 * @property {string} prompt - the prompt to be injected in the end of the main prompt
 * @property {boolean} is_enabled - whether the prompt will be used or not
 */

/**
 * @typedef {object} ThinkingPromptTuple
 * @property {?string} owner - the character that "owns" these prompts. Empty value means no owner (default prompts)
 * @property {JQuery<HTMLDivElement>|ParentNode} prompts_element - the DOM element visualizing the prompt settings
 * @property {ThinkingPrompt[]} prompts_settings - the corresponding stored prompt settings
 */

/**
 * @type {{thinking_prompts: ThinkingPrompt[]}}
 */
const defaultThinkingPromptSettings = {
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
function loadThinkingPromptSettings() {
    const list = $('#stepthink_prompt_list');

    settings.thinking_prompts.forEach(prompt => {
        renderThinkingPromptAt(
            prompt.id,
            {
                prompts_element: list,
                prompts_settings: settings.thinking_prompts,
            },
        );
    });
}

/**
 * @return {void}
 */
function registerThinkingPromptListeners() {
    $('#stepthink_prompt_list_add').on('click', onPromptItemAdd({
        prompts_element: $('#stepthink_prompt_list'),
        prompts_settings: settings.thinking_prompts,
    }));
}

/**
 * @param {number} id
 * @param {ThinkingPromptTuple} promptTuple
 */
function renderThinkingPromptAt(id, promptTuple) {
    const currentSetting = promptTuple.prompts_settings.find(prompt => prompt.id === id);

    const textArea = document.createElement('textarea');
    textArea.setAttribute('data-id', String(id));
    textArea.setAttribute('rows', '6');
    textArea.classList.add('text_pole', 'textarea_compact');
    if (currentSetting.prompt) {
        textArea.value = currentSetting.prompt;
    }
    textArea.addEventListener('input', onPromptItemInput(promptTuple));

    const buttonsContainer = document.createElement('div');
    buttonsContainer.classList.add('flex-container', 'alignItemsCenter', 'flexFlowColumn');

    const isEnabledButton = document.createElement('input');
    isEnabledButton.setAttribute('data-id', String(id));
    isEnabledButton.setAttribute('type', 'checkbox');
    isEnabledButton.setAttribute('title', 'Enable prompt');
    if (currentSetting.is_enabled !== false) {
        isEnabledButton.setAttribute('checked', 'checked');
    }
    isEnabledButton.addEventListener('input', onPromptItemEnable(promptTuple));

    const removeButton = document.createElement('div');
    removeButton.setAttribute('data-id', String(id));
    removeButton.setAttribute('title', 'Remove prompt');
    removeButton.classList.add('menu_button', 'menu_button_icon', 'fa-solid', 'fa-trash', 'redWarningBG');
    removeButton.addEventListener('click', onPromptItemRemove(promptTuple));

    buttonsContainer.append(isEnabledButton, removeButton);

    const listItem = document.createElement('div');
    listItem.setAttribute('id', `stepthink_prompt_item--${promptTuple?.owner}--${id}`);
    listItem.classList.add('flex-container', 'marginTopBot5', 'alignItemsCenter');

    listItem.append(textArea, buttonsContainer);

    promptTuple.prompts_element.append(listItem);
}

/**
 * @param {ThinkingPromptTuple} promptTuple
 * @return {(function(): void)}
 */
function onPromptItemAdd(promptTuple) {
    return function () {
        const promptsCount = promptTuple.prompts_settings.length;
        const id = promptsCount > 0 ? promptTuple.prompts_settings[promptsCount - 1].id + 1 : 0;

        promptTuple.prompts_settings.push({ id: id, prompt: '', is_enabled: true });
        renderThinkingPromptAt(id, promptTuple);

        saveSettingsDebounced();
    };
}

/**
 * @param {ThinkingPromptTuple} promptTuple
 * @return {(function(): void)}
 */
function onPromptItemInput(promptTuple) {
    return function (event) {
        const id = Number(event.target.getAttribute('data-id'));

        const value = event.target.value;
        const changedPrompt = promptTuple.prompts_settings.find(prompt => prompt.id === id);
        changedPrompt.prompt = value;
        saveSettingsDebounced();
    };
}


/**
 * @param {ThinkingPromptTuple} promptTuple
 * @return {(function(): void)}
 */
function onPromptItemEnable(promptTuple) {
    return function (event) {
        const id = Number(event.target.getAttribute('data-id'));

        const value = event.target.checked;
        const changedPrompt = promptTuple.prompts_settings.find(prompt => prompt.id === id);
        changedPrompt.is_enabled = value;
        saveSettingsDebounced();
    };
}

/**
 * @param {ThinkingPromptTuple} promptTuple
 * @return {(function(): void)}
 */
function onPromptItemRemove(promptTuple) {
    return function (event) {
        const id = Number(event.target.getAttribute('data-id'));

        $(`#stepthink_prompt_item--${promptTuple?.owner}--${id}`).remove();

        const arrayIndexToDelete = promptTuple.prompts_settings.findIndex(prompt => prompt.id === id);
        promptTuple.prompts_settings.splice(arrayIndexToDelete, 1);

        saveSettingsDebounced();
    };
}