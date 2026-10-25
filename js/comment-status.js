/**
 * Вычисляет статус ответа для комментариев одного фото.
 *
 * В рабочем процессе сообщества исходное сообщение обычно пишет покупатель,
 * а администратор отвечает от личного аккаунта. Поэтому нельзя считать
 * администраторским только сообщение текущего пользователя: отвечать могут
 * несколько администраторов. В пределах ветки автор корневого сообщения
 * считается покупателем; сообщения других авторов — ответами администрации.
 * Если корень заведомо принадлежит текущему администратору/сообществу, покупателем
 * считается первый автор, не совпадающий с известным администратором.
 */
function commentId(comment) {
    const id = Number(comment?.id || comment?.cid || 0);
    return Number.isFinite(id) && id > 0 ? id : null;
}

function directParentId(comment) {
    const stored = Number(comment?._parent_comment_id || 0);
    if (stored > 0) return stored;

    const direct = Number(comment?.reply_to_comment || comment?.reply_to_comment_id || 0);
    if (direct > 0) return direct;

    const stack = Array.isArray(comment?.parents_stack) ? comment.parents_stack : [];
    const fromStack = Number(stack[stack.length - 1] || 0);
    return fromStack > 0 ? fromStack : null;
}

function mentionedAuthorId(text) {
    const match = String(text || "").match(/^\s*\[((?:id|club|public))(\d+)\|[^\]]+\]/i);
    if (!match) return null;

    const id = Number(match[2] || 0);
    if (!id) return null;
    return match[1].toLowerCase() === "id" ? id : -Math.abs(id);
}

export function markUnansweredComments(items, options = {}) {
    const list = Array.isArray(items) ? items : [];
    const currentUserId = Number(options.currentUserId || 0);
    const communityOwnerId = Number(options.communityOwnerId || 0);
    const byId = new Map();

    for (const comment of list) {
        const id = commentId(comment);
        if (id) byId.set(String(id), comment);
    }

    const rootMemo = new Map();
    function getRoot(comment, visiting = new Set()) {
        const id = commentId(comment);
        const key = id ? String(id) : null;
        if (key && rootMemo.has(key)) return rootMemo.get(key);
        if (key && visiting.has(key)) return comment;

        const parentId = directParentId(comment);
        const parent = parentId ? byId.get(String(parentId)) : null;
        let root = comment;
        if (parent && parent !== comment) {
            const nextVisiting = new Set(visiting);
            if (key) nextVisiting.add(key);
            root = getRoot(parent, nextVisiting);
        }
        if (key) rootMemo.set(key, root);
        return root;
    }

    const membersByRoot = new Map();
    for (const comment of list) {
        const root = getRoot(comment);
        const rootId = commentId(root);
        const key = rootId ? String(rootId) : `orphan:${String(root?.from_id || 0)}:${String(root?.date || 0)}`;
        if (!membersByRoot.has(key)) membersByRoot.set(key, { root, members: [] });
        membersByRoot.get(key).members.push(comment);
    }

    const knownAdmin = comment => {
        const authorId = Number(comment?.from_id || 0);
        return Boolean(
            (currentUserId && authorId === currentUserId) ||
            (communityOwnerId && authorId === communityOwnerId)
        );
    };

    const customerByRoot = new Map();
    for (const [key, thread] of membersByRoot) {
        const { root, members } = thread;
        const rootAuthorId = Number(root?.from_id || 0);
        let customerAuthorId = rootAuthorId || null;

        if (knownAdmin(root)) {
            const candidates = members
                .filter(comment => !knownAdmin(comment) && Number(comment?.from_id || 0) !== 0)
                .sort((a, b) => Number(a?.date || 0) - Number(b?.date || 0));
            customerAuthorId = candidates.length ? Number(candidates[0].from_id) : null;
        } else {
            // Если корень ветки не попал в текущую выборку, но показан ответ
            // с упоминанием покупателя, используем это упоминание как автора
            // исходного вопроса, чтобы не помечать ответ администратора.
            const parentId = directParentId(root);
            const mentionedId = mentionedAuthorId(root?.text);
            if (parentId && !byId.has(String(parentId)) && mentionedId && mentionedId !== rootAuthorId) {
                customerAuthorId = mentionedId;
            }
        }

        customerByRoot.set(key, customerAuthorId);
    }

    function rootKeyFor(comment) {
        const root = getRoot(comment);
        const id = commentId(root);
        return id ? String(id) : `orphan:${String(root?.from_id || 0)}:${String(root?.date || 0)}`;
    }

    function isCustomerMessage(comment) {
        if (knownAdmin(comment)) return false;
        const customerAuthorId = customerByRoot.get(rootKeyFor(comment));
        return customerAuthorId !== null && customerAuthorId !== undefined &&
            Number(comment?.from_id || 0) === Number(customerAuthorId);
    }

    // Ответ администратора закрывает только то конкретное сообщение, на которое
    // он ответил, а не все сообщения выше по цепочке. Иначе новый вопрос покупателя
    // внутри уже отвеченной ветки ошибочно считался бы закрытым.
    const adminAnswered = new Set();
    for (const comment of list) {
        if (isCustomerMessage(comment)) continue;
        const parentId = directParentId(comment);
        if (parentId) adminAnswered.add(String(parentId));
    }

    const unansweredIds = new Set();
    for (const comment of list) {
        const id = commentId(comment);
        const unanswered = Boolean(
            id && isCustomerMessage(comment) && !adminAnswered.has(String(id))
        );
        comment._unanswered = unanswered;
        if (unanswered) unansweredIds.add(String(id));
    }

    return unansweredIds;
}
