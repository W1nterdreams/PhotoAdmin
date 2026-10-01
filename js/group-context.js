import { state } from "./state.js?v=20261001-owner-red44";
import { ALLOW_USERS, ALLOWED_GROUP_IDS } from "./config.js?v=20261001-owner-red44";

let lastAccessDiagnostic = null;

const ALLOWED_GROUP_ROLES = new Set(["admin", "editor", "moder"]);
const BLOCKED_GROUP_ROLES = new Set(["member", "none"]);
const ALLOWED_GROUPS = new Set(
    ALLOWED_GROUP_IDS
        .map(Number)
        .filter(id => Number.isInteger(id) && id > 0)
);

export class AppAccessDeniedError extends Error {
    constructor(message, code = "APP_ACCESS_DENIED") {
        super(message);
        this.name = "AppAccessDeniedError";
        this.code = code;
    }
}

export class GroupAccessDeniedError extends AppAccessDeniedError {
    constructor(message, code = "GROUP_ACCESS_DENIED") {
        super(message, code);
        this.name = "GroupAccessDeniedError";
    }
}

/**
 * ID сообщества берём из launch params VK Mini Apps.
 * При обычном запуске приложения параметра vk_group_id нет — это личный режим.
 */
function readGroupIdFromLaunchParams() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("vk_group_id") || params.get("group_id");
    const id = Number(raw);

    return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * VK передаёт роль пользователя в текущем сообществе прямо в launch params.
 * Для режима управления сообществом разрешаем руководителей:
 * admin / editor / moder. Обычный участник и пользователь без членства
 * (member / none) не допускаются.
 */
function readViewerGroupRoleFromLaunchParams() {
    const params = new URLSearchParams(window.location.search);
    const role = String(params.get("vk_viewer_group_role") || "")
        .trim()
        .toLowerCase();

    return role || null;
}

function getLaunchContext() {
    return {
        groupId: readGroupIdFromLaunchParams(),
        viewerGroupRole: readViewerGroupRoleFromLaunchParams()
    };
}

function roleLabel(role) {
    switch (role) {
        case "admin": return "admin";
        case "editor": return "editor";
        case "moder": return "moderator";
        case "member": return "member";
        case "none": return "none";
        default: return role || "missing";
    }
}

function rememberDiagnostic(data) {
    lastAccessDiagnostic = {
        checkedAt: Date.now(),
        allowUsers: ALLOW_USERS,
        allowedGroupIds: [...ALLOWED_GROUPS],
        ...data
    };
}

/**
 * Проверка режима запуска до подключения рабочего интерфейса.
 *
 * 1) Если приложение открыто из сообщества — проверяем белый список групп и роль.
 * 2) Если vk_group_id отсутствует — это личный режим. Он разрешается единым
 *    флагом ALLOW_USERS и не имеет дополнительных пользовательских ограничений.
 */
export function precheckLaunchAccess() {
    const { groupId, viewerGroupRole } = getLaunchContext();

    if (!groupId) {
        if (!ALLOW_USERS) {
            rememberDiagnostic({
                ok: false,
                mode: "user",
                groupId: null,
                viewerGroupRole,
                reason: "user-mode-disabled"
            });

            throw new AppAccessDeniedError(
                "Работа с личными фотоальбомами сейчас отключена настройкой приложения.",
                "USER_ACCESS_DISABLED"
            );
        }

        rememberDiagnostic({
            ok: true,
            mode: "user",
            groupId: null,
            viewerGroupRole,
            accessSource: "user-mode-flag"
        });

        return {
            mode: "user",
            groupId: null,
            viewerGroupRole: null
        };
    }

    if (!ALLOWED_GROUPS.has(groupId)) {
        rememberDiagnostic({
            ok: false,
            mode: "group",
            groupId,
            viewerGroupRole,
            reason: "group-not-allowed"
        });

        throw new GroupAccessDeniedError(
            "Это сообщество пока не подключено к приложению.",
            "GROUP_NOT_ALLOWED"
        );
    }

    if (ALLOWED_GROUP_ROLES.has(viewerGroupRole)) {
        rememberDiagnostic({
            ok: true,
            mode: "group",
            groupId,
            viewerGroupRole,
            accessSource: "vk_viewer_group_role"
        });

        return { mode: "group", groupId, viewerGroupRole };
    }

    if (BLOCKED_GROUP_ROLES.has(viewerGroupRole)) {
        rememberDiagnostic({
            ok: false,
            mode: "group",
            groupId,
            viewerGroupRole,
            reason: "role-not-allowed",
            accessSource: "vk_viewer_group_role"
        });

        throw new GroupAccessDeniedError(
            "Управление фотоальбомами сообщества доступно только его руководителям " +
            "(администратор, редактор или модератор)."
        );
    }

    // Неизвестную или отсутствующую роль в групповом запуске не считаем
    // безопасным основанием для доступа.
    rememberDiagnostic({
        ok: false,
        mode: "group",
        groupId,
        viewerGroupRole,
        reason: "unknown-or-missing-role",
        accessSource: "vk_viewer_group_role"
    });

    throw new GroupAccessDeniedError(
        "VK не передал распознаваемую роль пользователя в сообществе. " +
        "Откройте приложение из страницы этого сообщества и повторите попытку.",
        "GROUP_ACCESS_CHECK_FAILED"
    );
}

/**
 * Формирует единый owner-контекст после загрузки VKWebAppGetUserInfo.
 * Все рабочие модули дальше используют getOwnerId():
 *   группа      -> отрицательный owner_id (-group_id)
 *   пользователь -> положительный owner_id (user_id)
 */
export function initOwnerContext(launchContext = null) {
    const context = launchContext || precheckLaunchAccess();

    console.log("FULL URL:", window.location.href);
    console.log("APP MODE:", context.mode);

    if (context.mode === "group") {
        const groupId = Number(context.groupId);
        const viewerGroupRole = context.viewerGroupRole;

        state.group = {
            id: groupId,
            ownerId: -Math.abs(groupId),
            name: "",
            isAdmin: viewerGroupRole === "admin",
            adminLevel: viewerGroupRole === "admin" ? 3 : viewerGroupRole === "editor" ? 2 : 1,
            viewerGroupRole,
            accessGranted: true,
            accessSource: "vk_viewer_group_role"
        };

        state.owner = {
            mode: "group",
            ownerId: state.group.ownerId,
            groupId,
            userId: Number(state.currentUser?.id || 0) || null,
            viewerGroupRole,
            accessGranted: true
        };

        console.log("VK GROUP ID:", groupId);
        console.log("VK VIEWER GROUP ROLE:", viewerGroupRole);
        console.log("PHOTO OWNER ID:", state.owner.ownerId);
        console.log(`GROUP ACCESS: ${roleLabel(viewerGroupRole)} allowed`);

        return state.owner;
    }

    const userId = Number(state.currentUser?.id || 0);
    if (!Number.isInteger(userId) || userId <= 0) {
        throw new AppAccessDeniedError(
            "VK не вернул корректный ID текущего пользователя.",
            "USER_CONTEXT_MISSING"
        );
    }

    state.group = null;
    state.owner = {
        mode: "user",
        ownerId: userId,
        groupId: null,
        userId,
        viewerGroupRole: null,
        accessGranted: true
    };

    console.log("VK USER ID:", userId);
    console.log("PHOTO OWNER ID:", state.owner.ownerId);
    console.log("USER ACCESS: allowed by ALLOW_USERS");

    return state.owner;
}

export function getOwnerId() {
    const ownerId = Number(state.owner?.ownerId);

    if (!Number.isInteger(ownerId) || ownerId === 0) {
        throw new Error(
            "Контекст владельца фотоальбомов не инициализирован: отсутствует owner_id."
        );
    }

    return ownerId;
}

export function getGroupId() {
    const groupId = Number(state.owner?.groupId || state.group?.id);

    if (!isGroupMode() || !Number.isInteger(groupId) || groupId <= 0) {
        throw new Error(
            "Текущий запуск не относится к сообществу: group_id недоступен."
        );
    }

    return groupId;
}

export function isGroupMode() {
    return state.owner?.mode === "group";
}

export function isUserMode() {
    return state.owner?.mode === "user";
}

export function getOwnerContext() {
    if (!state.owner?.accessGranted || !state.owner?.mode) {
        throw new Error(
            "Контекст владельца фотоальбомов не инициализирован или доступ не подтверждён."
        );
    }

    return state.owner;
}

// Сохраняем прежний экспорт для модулей/отладки, которые могут обращаться
// именно к групповому контексту.
export function getGroupContext() {
    if (!state.group?.id || state.group?.accessGranted !== true) {
        throw new Error(
            "Контекст сообщества не инициализирован или текущий запуск является личным."
        );
    }

    return state.group;
}

// Совместимые имена старого API этого модуля.
export const precheckLaunchGroupAccess = precheckLaunchAccess;
export const initGroupContext = initOwnerContext;

if (typeof window !== "undefined") {
    window.groupAccessDebug = {
        status: () => lastAccessDiagnostic
            ? JSON.parse(JSON.stringify(lastAccessDiagnostic))
            : null,
        owner: () => state.owner
            ? JSON.parse(JSON.stringify(state.owner))
            : null
    };
}
