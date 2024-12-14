import {
    addOneMessage,
    event_types,
    eventSource,
    extractMessageBias,
    removeMacros,
    saveChatConditional,
    scrollChatToBottom,
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
 */
/**
 * @type {ThoughtsStrategy}
 */
let currentStrategy;

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
 * @typedef {object} ThoughtsGeneration
 * @property {string} header
 * @property {array<{
 *     id: number,
 *     thought: string,
 * }>} thoughts
 */
/**
 * @implements {ThoughtsStrategy}
 */
class EmbeddedThoughtsStrategy {
    /**
     * @var {EmbeddedThoughtsStrategy}
     */
    static #instance;

    static getInstance() {
        if (!EmbeddedThoughtsStrategy.#instance) {
            EmbeddedThoughtsStrategy.#instance = new EmbeddedThoughtsStrategy();
        }

        return EmbeddedThoughtsStrategy.#instance;
    }

    /**
     * @return {Promise<void>}
     */
    async hideThoughts() {
    }

    /**
     * @param {OnSendThoughtsTemplateEvent} event
     * @return {Promise<void>}
     */
    async sendCharacterTemplateMessage(event) {
        const context = getContext();
        const thoughtsMetadataId = 'last';

        /** @type {ThoughtsGeneration} */
        context.chatMetadata.thought_generation = { header: '<h4>Thinking...<h4/>', thoughts: [] };

        const lastMessage = $(`#chat .mes[mesid="${context.chat.length - 1}"]`);

        const thoughtsTemplate = this.#createThoughtsBlock(
            thoughtsMetadataId,
            context.chatMetadata.thought_generation.header
        );

        lastMessage.removeClass('last_mes');
        lastMessage.after(thoughtsTemplate);

        event.thoughtsMetadataId = thoughtsMetadataId;

        scrollChatToBottom();
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

        const thoughtsTemplate = this.#findThoughtsBlock(event.thoughtsMetadataId);
        thoughtsTemplate.innerHTML += thoughtGeneration.thoughts[newThoughtsLength - 1].thought;

        scrollChatToBottom();
    }

    /**
     * @param {OnSaveThoughtsEvent} event
     * @return {Promise<void>}
     */
    async saveCharacterThoughts(event) {
        const context = getContext();
        const generatedThoughts = context.chatMetadata.thought_generation;

        const message = context.chat[event.messageId];

        message.thoughts_id = uuidv4();
        message.character_thoughts = generatedThoughts;

        const thoughtsBlock = this.#findThoughtsBlock(event.thoughtsMetadataId);
        this.#updateThoughtBlockId(thoughtsBlock, message.thoughts_id);

        const messageBlock = document.querySelector(`#chat .mes[mesid="${event.messageId}"]`);
        this.#attachMessageToThoughts(messageBlock, message.thoughts_id);

        context.chatMetadata.thought_generation = null;

        await saveChatConditional();
    }

    /**
     * @param {OnRenderThoughtsEvent} event
     * @return {Promise<void>}
     */
    async renderCharacterThoughts(event) {
        const context = getContext();

        // Crutch for fixing detached thoughts block after clicking the "show more messages" button
        if (!event.isInitialCall) {
            const firstThoughtsBlock = $('#chat .thoughts').first();
            if (!firstThoughtsBlock.prev().hasClass('mes')) {
                const misplacedThoughtId = firstThoughtsBlock.attr('thoughts_id');
                const properMessage = $(`#chat .mes[thoughts_id="${misplacedThoughtId}"]`);
                properMessage.before(firstThoughtsBlock);
            }
        }

        $('#chat .mes').each((id, messageBlock) => {
            if (messageBlock.getAttribute('thoughts_rendered') === 'true') {
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
                message.character_thoughts.header
            );
            for (const thought of message.character_thoughts.thoughts) {
                thoughtsBlock.innerHTML += thought.thought;
            }

            messageBlock.before(thoughtsBlock);
            this.#attachMessageToThoughts(messageBlock, message.thoughts_id);
        });

        if (event.isInitialCall) {
            scrollChatToBottom();
        }
    }

    /**
     * @param {string} id
     * @param {?string} content
     * @return {HTMLDivElement}
     */
    #createThoughtsBlock(id, content = null) {
        const thoughtsBlock = document.createElement('div');

        thoughtsBlock.setAttribute('id', `thoughts_mes--${id}`);
        thoughtsBlock.setAttribute('thoughts_id', id);

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
}
