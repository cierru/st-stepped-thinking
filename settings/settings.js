import { extensionName } from '../index.js';
import {
    event_types,
    eventSource,
    extension_prompt_roles,
    saveSettings,
    saveSettingsDebounced,
} from '../../../../../script.js';
import { select2ChoiceClickSubscribe } from '../../../../utils.js';
import { getCharacterSettings, switchMode } from '../thinking/engine.js';
import { extension_settings, getContext, renderExtensionTemplateAsync } from '../../../../extensions.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../popup.js';
import { loadDefaultModeDeclarations, modesIterator } from '../thinking/mode.js';

const lastPopupVersion = '3';

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
    handleUpgradingToV3Installations();

    extension_settings[extensionName] = extension_settings[extensionName] || {};
    setDefaultsForUndefined(extension_settings[extensionName]);

    settings = extension_settings[extensionName];

    loadDefaultModeDeclarations();

    loadCommonSettings();
    loadThinkingPromptSettings();
    loadCharacterSettings();
}

/**
 * @return {void}
 */
function handleUpgradingToV3Installations() {
    if (extension_settings[extensionName] && extension_settings[extensionName].shown_popup_version !== lastPopupVersion) {
        if (!extension_settings[extensionName].mode) {
            extension_settings[extensionName].mode = 'separated';
            saveSettingsDebounced();
        }
        callGenericPopup(
            '<b>Stepped Thinking v3 is out!</b><br/>Try the new "Embedded" mode, which you can select in the Stepped Thinking settings menu.'
            + ' Just remember that it is mutually incompatible with the old "Separated" mode.',
            POPUP_TYPE.TEXT
        );
    }
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

// settings - common

export const thoughtPrefixInjectionModes = {
    ALWAYS: 'always',
    FROM_INSTRUCT: 'from_instruct',
    GROUPS: 'groups',
    NEVER: 'never',
};

const defaultCommonSettings = {
    'shown_popup_version': lastPopupVersion,
    'is_shutdown': false,
    'is_enabled': true,
    'is_wian_skipped': false,
    'is_thinking_popups_enabled': true,
    'is_thoughts_spoiler_open': false,
    'is_thoughts_as_system': false,
    'mode': 'embedded',
    'max_thoughts_in_prompt': 2,
    'generation_delay': 0.0,
    'max_response_length': 0,
    'regexp_to_sanitize': '(<\\/?details\\s?(type="executing")?>)|(<\\/?summary>)|(Thinking ({{char}}) 💭)|(```)|(<\\/?[\\w\\s]*>)',
    'max_hiding_thoughts_lookup': 1000,

    // separated
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

    // embedded
    'sending_thoughts_role': extension_prompt_roles.SYSTEM,
    'thoughts_block_title': '{{char}}\'s Thoughts',
    'thoughts_prefix_injection_mode': thoughtPrefixInjectionModes.FROM_INSTRUCT,
    'thoughts_injection_prefix': '{{char}}\'s Thoughts: ',
    'general_injection_template': '{{prefix}}{{thoughts}}',
    'thought_injection_template': '<{{prompt_name.toLowerCase()}}>{{thought}}</{{prompt_name.toLowerCase()}}>',
    'thought_injection_separator': '\n',
};

/**
 * @return {void}
 */
function loadCommonSettings() {
    $('#stepthink_is_shutdown').addClass(settings.is_shutdown ? 'stepthink_shutdown_turn_on' : 'stepthink_shutdown_turn_off');

    renderAvailableThinkingModes();
    $(`#stepthink_mode option[value="${settings.mode}"]`).prop('selected', 'true');
    activateThinkingMode(settings.mode);

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

    $(`#stepthink_sending_thoughts_role option[value="${settings.sending_thoughts_role}"]`).prop('selected', 'true');
    $('#stepthink_thoughts_block_title').val(settings.thoughts_block_title);
    $(`#stepthink_thoughts_prefix_injection_mode option[value="${settings.thoughts_prefix_injection_mode}"]`).prop('selected', 'true');
    $('#stepthink_thoughts_injection_prefix').val(settings.thoughts_injection_prefix);
    $('#stepthink_general_injection_template').val(settings.general_injection_template);
    $('#stepthink_thought_injection_template').val(settings.thought_injection_template);
    $('#stepthink_thought_injection_separator').val(settings.thought_injection_separator);

    $('#stepthink_thoughts_placeholder_start').val(settings.thoughts_placeholder.start);
    $('#stepthink_thoughts_placeholder_content').val(settings.thoughts_placeholder.content);
    $('#stepthink_thoughts_placeholder_default_content').val(settings.thoughts_placeholder.default_content);
    $('#stepthink_thoughts_placeholder_end').val(settings.thoughts_placeholder.end);
}

/**
 * @return {void}
 */
function registerCommonSettingListeners() {
    $('#stepthink_is_shutdown').on('click', onShutdownClick);

    $('#stepthink_mode').on('input', onSwitchThinkingMode);

    $('#stepthink_is_enabled').on('input', onCheckboxInput('is_enabled'));
    $('#stepthink_is_shutdown').on('input', onCheckboxInput('is_shutdown'));
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

    $('#stepthink_sending_thoughts_role').on('input', onIntegerTextareaInput('sending_thoughts_role'));
    $('#stepthink_thoughts_block_title').on('input', onTextareaInput('thoughts_block_title'));
    $('#stepthink_thoughts_prefix_injection_mode').on('input', onTextareaInput('thoughts_prefix_injection_mode'));
    $('#stepthink_thoughts_injection_prefix').on('input', onTextareaInput('thoughts_injection_prefix'));
    $('#stepthink_general_injection_template').on('input', onTextareaInput('general_injection_template'));
    $('#stepthink_thought_injection_template').on('input', onTextareaInput('thought_injection_template'));
    $('#stepthink_thought_injection_separator').on('input', onTextareaInput('thought_injection_separator'));
    $('#stepthink_restore_thought_injection_template').on('click', () =>
        $('#stepthink_thought_injection_template').val(defaultCommonSettings.thought_injection_template).trigger('input'),
    );

    $('#stepthink_thoughts_placeholder_start').on('input', onTextareaInput('thoughts_placeholder', 'start'));
    $('#stepthink_thoughts_placeholder_content').on('input', onTextareaInput('thoughts_placeholder', 'content'));
    $('#stepthink_thoughts_placeholder_default_content').on('input', onTextareaInput('thoughts_placeholder', 'default_content'));
    $('#stepthink_thoughts_placeholder_end').on('input', onTextareaInput('thoughts_placeholder', 'end'));

    $('#stepthink_additional_settings_toggle').on('click', () => $('#stepthink_additional_settings').slideToggle(200, 'swing'));

    $('#stepthink_restore_regexp_to_sanitize').on('click', () =>
        $('#stepthink_regexp_to_sanitize').val(defaultCommonSettings.regexp_to_sanitize).trigger('input'),
    );
    $('#stepthink_restore_thoughts_message_template').on('click', () =>
        $('#stepthink_thoughts_message_template').val(defaultCommonSettings.thoughts_message_template).trigger('input'),
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
 * @return {void}
 */
async function onShutdownClick() {
    if (!settings.is_shutdown) {
        const confirmationResult = await callGenericPopup(
            'Are you sure you want to shut down Stepped Thinking? You won\'t lose the generated thoughts.<br/>The page will be reloaded.',
            POPUP_TYPE.CONFIRM,
        );
        if (!confirmationResult) {
            return;
        }
    }

    settings.is_shutdown = !settings.is_shutdown;
    await saveSettings();

    location.reload();
}

/**
 * @return {void}
 */
function onSwitchThinkingMode() {
    settings.mode = $(this).val();
    activateThinkingMode(settings.mode);

    saveSettingsDebounced();
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
 * @param {...string} settingNames
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
    if (Number.isFinite(value) || value < 0.0) {
        return;
    }

    settings.generation_delay = value;
    saveSettingsDebounced();
}

/**
 * @return {void}
 */
function renderAvailableThinkingModes() {
    const selector = $('#stepthink_mode');
    for (const declaration of modesIterator()) {
        selector.append($('<option>', { value: declaration.name, text: declaration.title }));
    }
}

/**
 * @param {string} mode
 * @return {void}
 */
function activateThinkingMode(mode) {
    switchMode(mode);

    $(`.stepthink_mode_${mode}`).show();
    for (const declaration of modesIterator()) {
        if (declaration.name !== mode) {
            $(`.stepthink_mode_${declaration.name}`).hide();
        }
    }
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
    if (getCharacterSettings()?.is_setting_enabled) {
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

    $(`#stepthink_prompt_list_add--${shortName}`).on('click', ThinkingPromptList.onPromptItemAdd(
        $(`#stepthink_prompt_list--${shortName}`),
        new ThinkingPromptSettings(
            setting.thinking_prompts,
            shortName,
        ),
    ));
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
                list,
                setting.thinking_prompts,
                shortName,
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
 * @property {string} name - name of the prompt (used only in the embedded thoughts mode)
 * @property {string} prompt - the prompt to be injected in the end of the main prompt
 * @property {boolean} is_enabled - whether the prompt will be used or not
 */

/**
 * @type {{thinking_prompts: ThinkingPrompt[]}}
 */
const defaultThinkingPromptSettings = {
    'thinking_prompts': [{
        'id': 0,
        'name': 'Thoughts',
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
        'name': 'Plans',
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
            list,
            settings.thinking_prompts,
        );
    });
}

/**
 * @return {void}
 */
function registerThinkingPromptListeners() {
    $('#stepthink_prompt_list_add').on('click', ThinkingPromptList.onPromptItemAdd(
        $('#stepthink_prompt_list'),
        new ThinkingPromptSettings(settings.thinking_prompts),
    ));
}

class ThinkingPromptSettings {
    /**
     * @var {ThinkingPrompt[]}
     */
    #settings;
    /**
     * @var {?string}
     */
    #owner;

    constructor(promptsSettings, owner = null) {
        this.#settings = promptsSettings;
        this.#owner = owner;
    }

    /**
     * @return {string}
     */
    get owner() {
        if (!this.#owner) {
            return '';
        }

        return this.#owner;
    }

    /**
     * @param {string} name
     * @param {string} prompt
     * @param {boolean} isEnabled
     * @return {number}
     */
    push(name, prompt, isEnabled) {
        const promptsCount = this.#settings.length;
        const id = promptsCount > 0 ? this.#settings[promptsCount - 1].id + 1 : 0;

        this.#settings.push({ id: id, name: name, prompt: prompt, is_enabled: isEnabled });

        return id;
    }

    /**
     * @param {number} id
     * @param {string} prompt
     * @return {void}
     */
    updatePrompt(id, prompt) {
        const setting = this.getSettingBy(id);
        setting.prompt = prompt;
    }

    /**
     * @param {number} id
     * @param {boolean} isEnabled
     * @return {void}
     */
    updateIsEnabled(id, isEnabled) {
        const setting = this.getSettingBy(id);
        setting.is_enabled = isEnabled;
    }

    /**
     * @param {number} id
     * @param {string} name
     * @return {void}
     */
    updateName(id, name) {
        const setting = this.getSettingBy(id);
        setting.name = name;
    }

    /**
     * @param {number} id
     * @return {void}
     */
    remove(id) {
        const arrayIndexToDelete = this.#settings.findIndex(prompt => prompt.id === id);
        this.#settings.splice(arrayIndexToDelete, 1);
    }

    /**
     * @param {number} id
     * @return {ThinkingPrompt}
     */
    getSettingBy(id) {
        return this.#settings.find(prompt => prompt.id === id);
    }
}

class ThinkingPromptList {
    /**
     * @var {JQuery<HTMLDivElement>|ParentNode}
     */
    #rootElement;
    /**
     * @var {ThinkingPromptSettings}
     */
    #promptSettings;

    constructor(rootElement, promptSettings) {
        this.#rootElement = rootElement;
        this.#promptSettings = promptSettings;
    }

    /**
     * @param {JQuery<HTMLDivElement>|ParentNode} rootElement
     * @param {ThinkingPromptSettings} promptSettings
     * @return {(function(): void)}
     */
    static onPromptItemAdd(rootElement, promptSettings) {
        const list = new ThinkingPromptList(rootElement, promptSettings);

        return function () {
            list.addSetting();
            saveSettingsDebounced();
        };
    }

    /**
     * @param {ThinkingPromptSettings} promptSettings
     * @return {(function(): void)}
     */
    static onPromptItemInput(promptSettings) {
        return function (event) {
            const id = Number(event.target.getAttribute('data-id'));
            const value = event.target.value;

            promptSettings.updatePrompt(id, value);

            saveSettingsDebounced();
        };
    }


    /**
     * @param {ThinkingPromptSettings} promptSettings
     * @return {(function(): void)}
     */
    static onPromptItemEnable(promptSettings) {
        return function (event) {
            const id = Number(event.target.getAttribute('data-id'));
            const value = event.target.checked;

            promptSettings.updateIsEnabled(id, value);

            saveSettingsDebounced();
        };
    }

    /**
     * @param {ThinkingPromptSettings} promptSettings
     * @return {(function(): void)}
     */
    static onPromptItemRename(promptSettings) {
        return function (event) {
            const id = Number(event.target.getAttribute('data-id'));
            const value = event.target.value;

            promptSettings.updateName(id, value);

            saveSettingsDebounced();
        };
    }

    /**
     * @param {ThinkingPromptSettings} promptSettings
     * @return {(function(): void)}
     */
    static onPromptItemRemove(promptSettings) {
        return function (event) {
            const id = Number(event.target.getAttribute('data-id'));

            $(`#stepthink_prompt_item--${promptSettings?.owner}--${id}`).remove();
            promptSettings.remove(id);

            saveSettingsDebounced();
        };
    }

    /**
     * @param {string} name
     * @param {string} prompt
     * @param {boolean} isEnabled
     * @return {void}
     */
    addSetting(name = '', prompt = '', isEnabled = true) {
        const id = this.#promptSettings.push(name, prompt, isEnabled);
        this.render(id);
    }

    /**
     * @param {number} id
     * @return {void}
     */
    render(id) {
        const mainContainer = this.#renderMainColumnContainer(id);

        mainContainer.append(
            this.#renderPromptColumnContainer(id),
            this.#renderButtonsColumnContainer(id)
        );

        this.#rootElement.append(mainContainer);
    }

    /**
     * @param {number} id
     * @return {HTMLDivElement}
     */
    #renderMainColumnContainer(id) {
        const mainContainer = document.createElement('div');
        mainContainer.setAttribute('id', `stepthink_prompt_item--${this.#promptSettings.owner}--${id}`);
        mainContainer.classList.add('flex-container', 'marginTopBot5', 'flexFlowRow');

        return mainContainer;
    }

    /**
     * @param {number} id
     * @return {HTMLDivElement}
     */
    #renderPromptColumnContainer(id) {
        const container = document.createElement('div');
        container.classList.add('flex-container', 'flexFlowColumn', 'thinking_prompt_container');

        container.append(
            this.#renderNameRowContainer(id),
            this.#renderPromptAreaRowContainer(id)
        );

        return container;
    }

    /**
     * @param {number} id
     * @return {HTMLDivElement}
     */
    #renderPromptAreaRowContainer(id) {
        const currentSetting = this.#promptSettings.getSettingBy(id);

        const container = document.createElement('div');
        container.classList.add('flex-container', 'justifySpaceBetween', 'alignItemsCenter', 'flexFlowRow');

        const textArea = document.createElement('textarea');
        textArea.setAttribute('data-id', String(id));
        textArea.setAttribute('rows', '6');
        textArea.classList.add('text_pole', 'textarea_compact');
        textArea.value = currentSetting.prompt;

        textArea.addEventListener('input', ThinkingPromptList.onPromptItemInput(this.#promptSettings));

        container.append(textArea);

        return container;
    }

    /**
     * @param {number} id
     * @return {HTMLDivElement}
     */
    #renderNameRowContainer(id) {
        const currentSetting = this.#promptSettings.getSettingBy(id);

        const container = document.createElement('div');
        container.classList.add('flex-container', 'justifySpaceBetween', 'alignItemsCenter', 'flexFlowRow', 'stepthink_mode_embedded');

        const label = document.createElement('label');
        label.setAttribute('title', 'A name that will be used as {{prompt_name}} in the thoughts injection template');
        label.innerText = 'Name:';

        const name = document.createElement('input');
        name.setAttribute('data-id', String(id));
        name.classList.add('text_pole', 'textarea_compact');
        name.value = currentSetting.name;

        name.addEventListener('input', ThinkingPromptList.onPromptItemRename(this.#promptSettings));

        container.append(label, name);
        if (settings.mode !== 'embedded') {
            container.style.display = 'none';
        }

        return container;
    }

    /**
     * @param {number} id
     * @return {HTMLDivElement}
     */
    #renderButtonsColumnContainer(id) {
        const currentSetting = this.#promptSettings.getSettingBy(id);

        const buttonsContainer = document.createElement('div');
        buttonsContainer.classList.add('flex-container', 'alignItemsCenter', 'justifyCenter', 'flexFlowColumn');

        const isEnabledButton = document.createElement('input');
        isEnabledButton.setAttribute('data-id', String(id));
        isEnabledButton.setAttribute('type', 'checkbox');
        isEnabledButton.setAttribute('title', 'Enable prompt');
        if (currentSetting.is_enabled !== false) {
            isEnabledButton.setAttribute('checked', 'checked');
        }
        isEnabledButton.addEventListener('input', ThinkingPromptList.onPromptItemEnable(this.#promptSettings));

        const removeButton = document.createElement('div');
        removeButton.setAttribute('data-id', String(id));
        removeButton.setAttribute('title', 'Remove prompt');
        removeButton.classList.add('menu_button', 'menu_button_icon', 'fa-solid', 'fa-trash', 'redWarningBG');
        removeButton.addEventListener('click', ThinkingPromptList.onPromptItemRemove(this.#promptSettings));

        buttonsContainer.append(isEnabledButton, removeButton);

        return buttonsContainer;
    }
}

/**
 * @param {number} id
 * @param {JQuery<HTMLDivElement>|ParentNode} promptElement
 * @param {ThinkingPrompt[]} promptsSettings
 * @param {?string} owner
 * @return {void}
 */
function renderThinkingPromptAt(id, promptElement, promptsSettings, owner = null) {
    const list = new ThinkingPromptList(
        promptElement,
        new ThinkingPromptSettings(promptsSettings, owner),
    );

    list.render(id);
}
