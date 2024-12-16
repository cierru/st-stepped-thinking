import {
    addOneMessage,
    event_types,
    eventSource,
    extension_prompts,
    extractMessageBias,
    removeMacros,
    saveChatConditional,
    scrollChatToBottom,
    setExtensionPrompt,
    updateMessageBlock,
} from '../../../../../script.js';
import { getCurrentCharacterSettings, thinkingEvents } from './engine.js';
import { getContext } from '../../../../extensions.js';
import { settings } from '../settings/settings.js';
import { hideChatMessageRange } from '../../../../chats.js';
import { getMessageTimeStamp } from '../../../../RossAscends-mods.js';
import { extensionName } from '../index.js';
import { uuidv4 } from '../../../../utils.js';

/**
 * @typedef {object} ThoughtsStrategy
 * @property {function(): Promise<void>} hideThoughts
 * @property {function(OnSendThoughtsTemplateEvent): Promise<void>} sendCharacterTemplateMessage
 * @property {function(OnPutThoughtsEvent): Promise<void>} putCharacterThoughts
 * @property {function(OnSaveThoughtsEvent): Promise<void>} saveCharacterThoughts
 * @property {function(OnRenderThoughtsEvent): Promise<void>} renderCharacterThoughts
 * @property {function(): void} makeIntermediateThoughtsOrphans
 * @property {function(): void} removeOrphanThoughts
 * @property {function(): Promise<void>} prepareGenerationPrompt
 */
/**
 * @type {ThoughtsStrategy}
 */
let currentStrategy;

export const LAST_THOUGHT_ID = 'last';

export function switchToSeparatedThoughts() {
    currentStrategy = SeparatedThoughtsStrategy.getInstance();
}

export function switchToEmbeddedThoughts() {
    currentStrategy = EmbeddedThoughtsStrategy.getInstance();
}

export function registerThinkingListeners() {
    eventSource.on(
        thinkingEvents.ON_HIDE,
        preventDefaultDecorator(async () => currentStrategy.hideThoughts()),
    );
    eventSource.on(
        thinkingEvents.ON_SEND_TEMPLATE,
        preventDefaultDecorator(async (event) => currentStrategy.sendCharacterTemplateMessage(event)),
    );
    eventSource.on(
        thinkingEvents.ON_PUT,
        preventDefaultDecorator(async (event) => currentStrategy.putCharacterThoughts(event)),
    );
    eventSource.on(
        thinkingEvents.ON_SAVE,
        preventDefaultDecorator(async (event) => currentStrategy.saveCharacterThoughts(event)),
    );
    eventSource.on(
        thinkingEvents.ON_RENDER,
        preventDefaultDecorator(async (event) => currentStrategy.renderCharacterThoughts(event)),
    );
    eventSource.on(
        thinkingEvents.ON_MAKE_ORPHANS,
        preventDefaultDecorator(async () => currentStrategy.makeIntermediateThoughtsOrphans()),
    );
    eventSource.on(
        thinkingEvents.ON_REMOVE_ORPHANS,
        preventDefaultDecorator(async () => currentStrategy.removeOrphanThoughts()),
    );
    eventSource.on(
        thinkingEvents.ON_PREPARE_GENERATION,
        preventDefaultDecorator(async () => currentStrategy.prepareGenerationPrompt()),
    );
}

/**
 * @param {function(ThinkingEvent): Promise|void} handler
 * @return {function(ThinkingEvent): void}
 */
function preventDefaultDecorator(handler) {
    return async function (event) {
        if (event.defaultPrevented) {
            return;
        }

        const result = handler(event);
        if (result instanceof Promise) {
            await result;
        }
    };
}

/**
 * @implements {ThoughtsStrategy}
 */
class SeparatedThoughtsStrategy {
    /**
     * @var {SeparatedThoughtsStrategy}
     */
    static #instance;

    static getInstance() {
        if (!SeparatedThoughtsStrategy.#instance) {
            SeparatedThoughtsStrategy.#instance = new SeparatedThoughtsStrategy();
        }

        return SeparatedThoughtsStrategy.#instance;
    }

    /**
     * @return {Promise<void>}
     */
    async hideThoughts() {
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
     * @param {OnSendThoughtsTemplateEvent} event
     * @return {Promise<void>}
     */
    async sendCharacterTemplateMessage(event) {
        const context = getContext();
        const openState = settings.is_thoughts_spoiler_open ? 'open' : '';

        const thoughtsMessage = settings.thoughts_message_template
            .replace('{{thoughts_spoiler_open_state}}', openState)
            .replace('{{thoughts_placeholder}}', this.#replaceThoughtsPlaceholder(settings.thoughts_placeholder.default_content));

        event.thoughtsMessageId = await this.#sendCharacterThoughts(
            context.characters[context.characterId],
            thoughtsMessage,
        );
    }

    /**
     * @param {OnPutThoughtsEvent} event
     * @return {Promise<void>}
     */
    async putCharacterThoughts(event) {
        const context = getContext();
        if (!context.chat[event.thoughtsMessageId]) {
            toastr.error('The message was not found at position ' + event.thoughtsMessageId + ', cannot insert thoughts. ' + 'Probably, the error was caused by unexpected changes in the chat.', 'Stepped Thinking', { timeOut: 10000 });
            return;
        }
        const message = context.chat[event.thoughtsMessageId];
        const defaultPlaceholder = this.#replaceThoughtsPlaceholder(settings.thoughts_placeholder.default_content);

        const isFirstThought = (message) => message.mes.search(defaultPlaceholder) !== -1;

        if (isFirstThought(message)) {
            message.mes = message.mes.replace(defaultPlaceholder, this.#replaceThoughtsPlaceholder(event.thought));
        } else {
            const lastThoughtEndIndex = message.mes.lastIndexOf(settings.thoughts_placeholder.end);

            if (lastThoughtEndIndex !== -1) {
                const indexToInsert = lastThoughtEndIndex + settings.thoughts_placeholder.end.length;
                message.mes = message.mes.substring(0, indexToInsert) + '\n' + this.#replaceThoughtsPlaceholder(event.thought) + message.mes.substring(indexToInsert);
            } else {
                console.debug('[Stepped Thinking] Unable to locate the end of the previous thought, inserting a new thought at the end of the message');
                message.mes += '\n' + this.#replaceThoughtsPlaceholder(event.thought);
            }
        }

        updateMessageBlock(event.thoughtsMessageId, message);

        await context.saveChat();

        if (settings.is_thoughts_spoiler_open) {
            scrollChatToBottom();
        }
    }

    /**
     * @return {Promise<void>}
     */
    async prepareGenerationPrompt() {
        // The prompt is automatically prepared based on the chat history in this strategy
    }

    /**
     * @param {OnSaveThoughtsEvent} event
     * @return {Promise<void>}
     */
    async saveCharacterThoughts(event) {
        // Thoughts are saved immediately after creating in this strategy
    }

    /**
     * @param {OnRenderThoughtsEvent} event
     * @return {Promise<void>}
     */
    async renderCharacterThoughts(event) {
        // Thoughts render automatically in this strategy
    }

    /**
     * @return {void}
     */
    makeIntermediateThoughtsOrphans() {
        // Cleaning the intermediate state is unnecessary in this strategy
    }

    /**
     * @return {void}
     */
    removeOrphanThoughts() {
        // No need to remove orphans in this strategy as they are not created
    }

    /**
     * @param {v1CharData} character
     * @param {string} text
     * @return {Promise<number>}
     */
    async #sendCharacterThoughts(character, text) {
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

        context.chat.push(message);

        const position = context.chat.length - 1;

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
    #replaceThoughtsPlaceholder(substitution) {
        const thoughtsPlaceholder = settings.thoughts_placeholder.start
            + settings.thoughts_placeholder.content
            + settings.thoughts_placeholder.end;
        return thoughtsPlaceholder.replace('{{thoughts}}', substitution);
    }
}

/**
 * @typedef {object} Thought
 * @property {number} id
 * @property {string} thought
 */
/**
 * @typedef {object} ThoughtsGeneration
 * @property {string} header
 * @property {boolean} is_hidden
 * @property {array<Thought>} thoughts
 */
/**
 * @implements {ThoughtsStrategy}
 */
class EmbeddedThoughtsStrategy {
    LAST_THOUGHT_ID = LAST_THOUGHT_ID;
    EXTENSION_PROMPT_PREFIX = 'STEPTHINK_THOUGHT_';

    /**
     * @var {EmbeddedThoughtsStrategy}
     */
    static #instance;

    /**
     * @var {EmbeddedThoughtsUI}
     */
    #ui;

    static getInstance() {
        if (!EmbeddedThoughtsStrategy.#instance) {
            EmbeddedThoughtsStrategy.#instance = new EmbeddedThoughtsStrategy(
                EmbeddedThoughtsUI.getInstance()
            );
        }

        return EmbeddedThoughtsStrategy.#instance;
    }

    constructor(ui) {
        this.#ui = ui;
    }

    /**
     * @param {OnSendThoughtsTemplateEvent} event
     * @return {Promise<void>}
     */
    async sendCharacterTemplateMessage(event) {
        const context = getContext();
        const thoughtsMetadataId = this.LAST_THOUGHT_ID;

        /** @type {ThoughtsGeneration} */
        context.chatMetadata.thought_generation = { header: '<h4>Thinking...<h4/>', is_hidden: false, thoughts: [] };

        this.#ui.purgeUnboundThoughts();
        this.#ui.insertThoughtsTemplateBlock(
            context.chat.length - 1,
            thoughtsMetadataId,
            context.chatMetadata.thought_generation.header
        );

        event.thoughtsMetadataId = thoughtsMetadataId;

        scrollChatToBottom();
    }

    /**
     * @return {Promise<void>}
     */
    async prepareGenerationPrompt() {
        const context = getContext();
        this.#purgeInjectedThoughts();

        const lastMessageId = context.chat.length - 1;
        for (let i = lastMessageId; i >= 0; i--) {
            const message = context.chat[i];
            if (message.character_thoughts && !message.character_thoughts.is_hidden) {
                this.#injectThoughts(message.character_thoughts.thoughts, message.thoughts_id, lastMessageId - i + 1);
            }
        }

        const lastThoughts = context.chatMetadata.thought_generation?.thoughts;
        if (lastThoughts) {
            this.#injectThoughts(lastThoughts, this.LAST_THOUGHT_ID, 0);
        }
    }

    /**
     * @param {OnPutThoughtsEvent} event
     * @return {Promise<void>}
     */
    async putCharacterThoughts(event) {
        const context = getContext();
        const thoughtGeneration = context.chatMetadata.thought_generation;

        const newThoughtsLength = thoughtGeneration.thoughts.push(
            {
                id: thoughtGeneration.thoughts.length,
                thought: `<p>${event.thought}<p/>`,
            },
        );

        this.#ui.addThoughtToBlock(event.thoughtsMetadataId, thoughtGeneration.thoughts[newThoughtsLength - 1].thought);

        scrollChatToBottom();
    }

    /**
     * @param {OnSaveThoughtsEvent} event
     * @return {Promise<void>}
     */
    async saveCharacterThoughts(event) {
        const context = getContext();
        const generatedThoughts = context.chatMetadata.thought_generation;
        if (!generatedThoughts) {
            return;
        }

        const message = context.chat[event.messageId];

        message.thoughts_id = uuidv4();
        message.character_thoughts = generatedThoughts;
        this.#ui.bindThoughtsBlock(event.messageId, message.thoughts_id, event.thoughtsMetadataId);

        context.chatMetadata.thought_generation = null;

        await saveChatConditional();
    }

    /**
     * @return {void}
     */
    makeIntermediateThoughtsOrphans() {
        const context = getContext();

        context.chatMetadata.thought_generation = null;
        this.#ui.unbindOrphanThoughtsBlock(this.LAST_THOUGHT_ID);
    }


    /**
     * @return {void}
     */
    removeOrphanThoughts() {
        this.#ui.purgeUnboundThoughts();
    }

    /**
     * @param {OnRenderThoughtsEvent} event
     * @return {Promise<void>}
     */
    async renderCharacterThoughts(event) {
        if (!event.isInitialCall) {
            this.#ui.removeUnboundThoughtBlocks();
        }

        this.#ui.renderThoughtBlocks();

        if (event.isInitialCall) {
            scrollChatToBottom();
        }
    }

    /**
     * @return {Promise<void>}
     */
    async hideThoughts() {
        const context = getContext();

        const currentCharacter = context.characters[context.characterId];
        const characterSettings = getCurrentCharacterSettings();

        const isMindReaderCharacter = Boolean(characterSettings && characterSettings.is_mind_reader);

        const lastMessageIndex = context.chat.length - 1;
        for (let i = lastMessageIndex, revealedThoughtsCount = []; i >= 0 && (lastMessageIndex - i < settings.max_hiding_thoughts_lookup); i--) {
            const message = context.chat[i];

            revealedThoughtsCount[message.name] ??= 0;
            revealedThoughtsCount[message.name] += this.#revealThought(
                context.chat[i],
                revealedThoughtsCount[message.name],
                currentCharacter.name,
                isMindReaderCharacter
            );
        }
    }

    /**
     * @param {array<Thought>} thoughts
     * @param {string} thoughtsId
     * @param {number} depth
     * @return {void}
     */
    #injectThoughts(thoughts, thoughtsId, depth) {
        const thoughtsPrompt = thoughts.reduce(
            (result, currentThought) => result + '|' + currentThought.thought,
            ''
        );

        setExtensionPrompt(`${this.EXTENSION_PROMPT_PREFIX}_${thoughtsId}`, thoughtsPrompt, 1, depth, true);
    }

    /**
     * @return {void}
     */
    #purgeInjectedThoughts() {
        for (const key of Object.keys(extension_prompts)) {
            if (key.startsWith(this.EXTENSION_PROMPT_PREFIX)) {
                delete extension_prompts[key];
            }
        }
    }

    /**
     * @param {object} message
     * @param {number} revealedCharThoughtsCount
     * @param {string} currentCharacterName
     * @param {boolean} isMindReaderCharacter
     * @return {number}
     */
    #revealThought(message, revealedCharThoughtsCount, currentCharacterName, isMindReaderCharacter) {
        const characterThoughts = message.character_thoughts;
        if (!characterThoughts) {
            return 0;
        }

        const previousHidingState = characterThoughts.is_hidden;
        characterThoughts.is_hidden = revealedCharThoughtsCount >= settings.max_thoughts_in_prompt
            || (!isMindReaderCharacter && currentCharacterName !== message.name);

        if (previousHidingState !== characterThoughts.is_hidden) {
            this.#ui.findThoughtAndRenderHidingState(message.thoughts_id, characterThoughts.is_hidden);
        }

        return characterThoughts.is_hidden ? 0 : 1;
    }
}

class EmbeddedThoughtsUI {
    /**
     * @var {EmbeddedThoughtsUI}
     */
    static #instance;

    static getInstance() {
        if (!EmbeddedThoughtsUI.#instance) {
            EmbeddedThoughtsUI.#instance = new EmbeddedThoughtsUI();
        }

        return EmbeddedThoughtsUI.#instance;
    }

    /**
     * @param {number} previousMessageId
     * @param {string} thoughtsId
     * @param {string} header
     * @return {void}
     */
    insertThoughtsTemplateBlock(previousMessageId, thoughtsId, header) {
        const lastMessage = document.querySelector(`#chat .mes[mesid="${previousMessageId}"]`);
        const thoughtsTemplate = this.#createThoughtsBlock(thoughtsId, header);

        lastMessage.classList.remove('last_mes');
        lastMessage.after(thoughtsTemplate);
    }

    /**
     * @param {string} id
     * @param {string} thought
     * @return {void}
     */
    addThoughtToBlock(id, thought) {
        const thoughtsTemplate = this.#findThoughtsBlock(id);
        thoughtsTemplate.innerHTML += thought;
    }

    /**
     * @param {int} messageToBindId
     * @param {string} thoughtsId
     * @param {?string} previousThoughtsId
     */
    bindThoughtsBlock(messageToBindId, thoughtsId, previousThoughtsId = null) {
        const thoughtsBlock = this.#findThoughtsBlock(previousThoughtsId ?? thoughtsId);
        this.#updateThoughtBlockId(thoughtsBlock, thoughtsId);

        const messageBlock = document.querySelector(`#chat .mes[mesid="${messageToBindId}"]`);
        this.#attachMessageToThoughts(messageBlock, thoughtsId);
    }

    /**
     * @param {string} id
     * @param {boolean} isHidden
     * @return {void}
     */
    findThoughtAndRenderHidingState(id, isHidden) {
        const thoughtsBlock = this.#findThoughtsBlock(id);
        if (thoughtsBlock) {
            this.#renderHidingState(thoughtsBlock, isHidden);
        }
    }

    /**
     * @return {void}
     */
    removeUnboundThoughtBlocks() {
        $('#chat .thoughts').each((_, thoughtsBlock) => {
            const thoughtsId = thoughtsBlock.getAttribute('thoughts_id');
            const boundMessageBlock = document.querySelector(`#chat .mes[thoughts_id="${thoughtsId}"]`);
            if (!boundMessageBlock) {
                thoughtsBlock.remove();
            }
        });
    }

    /**
     * @return {void}
     */
    renderThoughtBlocks() {
        const context = getContext();

        $('#chat .mes').each((_, messageBlock) => {
            if (messageBlock.getAttribute('thoughts_rendered') === 'true') {
                this.#reattachDetachedThoughtBlocks(messageBlock);
                return;
            }

            const messageId = messageBlock.getAttribute('mesid');
            const message = context.chat[messageId];
            if (!message.character_thoughts) {
                messageBlock.setAttribute('thoughts_rendered', 'true');
                return;
            }

            const thoughtsBlock = this.#createThoughtsBlock(
                message.thoughts_id,
                message.character_thoughts.header,
            );
            this.#renderHidingState(thoughtsBlock, message.character_thoughts.is_hidden);
            for (const thought of message.character_thoughts.thoughts) {
                thoughtsBlock.innerHTML += thought.thought;
            }

            messageBlock.before(thoughtsBlock);
            this.#attachMessageToThoughts(messageBlock, message.thoughts_id);
        });
    }

    /**
     * @param {string} id
     * @return {void}
     */
    unbindOrphanThoughtsBlock(id) {
        const lastThoughtsBlock = this.#findThoughtsBlock(id);
        if (!lastThoughtsBlock) {
            return;
        }

        const siblingElement = this.#findClosestSibling(lastThoughtsBlock, 'mes', 'down');
        if (siblingElement
            && siblingElement.classList.contains('mes')
            && siblingElement.getAttribute('thoughts_rendered') !== 'true') {
            return;
        }

        lastThoughtsBlock.classList.add('unbound_thoughts');
    }

    /**
     * @return {void}
     */
    purgeUnboundThoughts() {
        document.querySelector('.unbound_thoughts')?.remove();
    }

    /**
     * This is a crutch required to fix detached thought blocks problem after clicking the "Show more messages" button
     *
     * @param {HTMLDivElement} messageBlock
     * @return {void}
     */
    #reattachDetachedThoughtBlocks(messageBlock) {
        const messageThoughtsId = messageBlock.getAttribute('thoughts_id');
        if (!messageThoughtsId) {
            return;
        }

        const boundThoughtsBlock = this.#findThoughtsBlock(messageThoughtsId);
        messageBlock.before(boundThoughtsBlock);
    }

    /**
     * @param {string} id
     * @param {?string} content
     * @return {HTMLDivElement}
     */
    #createThoughtsBlock(id, content = null) {
        const thoughtsBlock = document.createElement('div');
        this.#updateThoughtBlockId(thoughtsBlock, id);

        thoughtsBlock.classList.add('thoughts');
        if (content !== null) {
            thoughtsBlock.innerHTML = content;
        }

        return thoughtsBlock;
    }

    /**
     * @param {HTMLDivElement} thoughtsBlock
     * @param {string} id
     * @return {void}
     */
    #updateThoughtBlockId(thoughtsBlock, id) {
        thoughtsBlock.setAttribute('id', `thoughts_mes--${id}`);
        thoughtsBlock.setAttribute('thoughts_id', id);
    }

    /**
     * @param {string} id
     * @return {HTMLDivElement}
     */
    #findThoughtsBlock(id) {
        return document.getElementById(`thoughts_mes--${id}`);
    }

    /**
     * @param {HTMLDivElement} messageBlock
     * @param {string} thoughtsId
     * @return {void}
     */
    #attachMessageToThoughts(messageBlock, thoughtsId) {
        messageBlock.setAttribute('thoughts_rendered', 'true');
        messageBlock.setAttribute('thoughts_id', thoughtsId);
    }

    #renderHidingState(thoughtsBlock, isHidden) {
        if (isHidden) {
            thoughtsBlock.innerHTML = '<i class="mes_ghost fa-solid fa-ghost"></i>' + thoughtsBlock.innerHTML;
        } else {
            thoughtsBlock.innerHTML = thoughtsBlock.innerHTML.replace('<i class="mes_ghost fa-solid fa-ghost"></i>', '');
        }
    }

    /**
     * @param {HTMLDivElement} startElement
     * @param {string} targetClass
     * @param {string} direction
     * @return {HTMLDivElement|null}
     */
    #findClosestSibling(startElement, targetClass, direction) {
        const findSibling = (element, getNextSibling) => {
            let sibling = getNextSibling(element);
            while (sibling) {
                if (sibling.classList.contains(targetClass)) {
                    return sibling;
                }
                sibling = getNextSibling(sibling);
            }

            return null;
        };

        if (direction === 'up') {
            return findSibling(startElement, element => element.previousElementSibling);
        }

        return findSibling(startElement, element => element.nextElementSibling);
    }
}
