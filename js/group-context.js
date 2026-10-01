import { state } from "./state.js?v=20260927-captiontop43";

let lastAccessDiagnostic = null;

const ALLOWED_GROUP_ROLES = new Set(["admin", "editor", "moder"]);
const BLOCKED_GROUP_ROLES = new Set(["member", "none"]);

export class GroupAccessDeniedError extends Error {
    constructor(message, code = "GROUP_ACCESS_DENIED") {
        super(message);
        this.name = "GroupAccessDeniedError";
        this.code = code;
    }
}

/**
 * ID сообщества берём из launch params VK Mini Apps.
 */
function readGroupIdFromLaunchParams() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("vk_group_id") || params.get("group_id");
    const id = Number(raw);

    return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * VK передаёт роль пользователя в текущем сообществе прямо в launch params.
 * Для нашего режима управления разрешаем руководителей сообщества:
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

/**
 * Единственная проверка доступа к приложению.
 *
 * Не используем:
 * - дополнительный scope для сообществ;
 * - запросы Groups API для проверки роли;
 * - community token.
 *
 * Это исключает лишние разрешения и ложные отказы реальным руководителям.
 */
export function precheckLaunchGroupAccess() {
    const { groupId, viewerGroupRole } = getLaunchContext();

    if (!groupId) {
        lastAccessDiagnostic = {
            checkedAt: Date.now(),
            ok: false,
            groupId: null,
            viewerGroupRole,
            reason: "missing-group-id"
        };

        throw new Error(
            "Не найден vk_group_id. " +
            "Откройте Mini App из сообщества VK, которым нужно управлять."
        );
    }

    if (ALLOWED_GROUP_ROLES.has(viewerGroupRole)) {
        lastAccessDiagnostic = {
            checkedAt: Date.now(),
            ok: true,
            groupId,
            viewerGroupRole,
            accessSource: "vk_viewer_group_role"
        };

        return { groupId, viewerGroupRole };
    }

    if (BLOCKED_GROUP_ROLES.has(viewerGroupRole)) {
        lastAccessDiagnostic = {
            checkedAt: Date.now(),
            ok: false,
            groupId,
            viewerGroupRole,
            reason: "role-not-allowed",
            accessSource: "vk_viewer_group_role"
        };

        throw new GroupAccessDeniedError(
            "Доступ к приложению разрешён только руководителям сообщества " +
            "(администратор, редактор или модератор)."
        );
    }

    // Неизвестную или отсутствующую роль не считаем безопасным основанием
    // для доступа. Это также помогает заметить изменение launch params VK.
    lastAccessDiagnostic = {
        checkedAt: Date.now(),
        ok: false,
        groupId,
        viewerGroupRole,
        reason: "unknown-or-missing-role",
        accessSource: "vk_viewer_group_role"
    };

    throw new GroupAccessDeniedError(
        "VK не передал распознаваемую роль пользователя в сообществе. " +
        "Откройте приложение из страницы этого сообщества и повторите попытку.",
        "GROUP_ACCESS_CHECK_FAILED"
    );
}

/**
 * Инициализация контекста сообщества после успешной проверки launch role.
 * Дополнительных запросов к Groups API здесь нет.
 */
export function initGroupContext() {
    const { groupId, viewerGroupRole } = precheckLaunchGroupAccess();

    console.log("FULL URL:", window.location.href);
    console.log("VK GROUP ID:", groupId);
    console.log("VK VIEWER GROUP ROLE:", viewerGroupRole);

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

    console.log("GROUP CONTEXT:", state.group);
    console.log("GROUP ID:", state.group.id);
    console.log("PHOTO OWNER ID:", state.group.ownerId);
    console.log(`GROUP ACCESS: ${roleLabel(viewerGroupRole)} allowed by vk_viewer_group_role`);

    return state.group;
}

export function getGroupId() {
    const groupId = Number(state.group?.id);

    if (!Number.isInteger(groupId) || groupId <= 0) {
        throw new Error(
            "Контекст сообщества не инициализирован: отсутствует group_id."
        );
    }

    return groupId;
}

export function getOwnerId() {
    const ownerId = Number(state.group?.ownerId);

    if (!Number.isInteger(ownerId) || ownerId >= 0) {
        throw new Error(
            "Контекст сообщества не инициализирован: отсутствует owner_id."
        );
    }

    return ownerId;
}

export function getGroupContext() {
    if (!state.group?.id || state.group?.accessGranted !== true) {
        throw new Error(
            "Контекст сообщества не инициализирован или доступ не подтверждён."
        );
    }

    return state.group;
}

if (typeof window !== "undefined") {
    window.groupAccessDebug = {
        status: () => lastAccessDiagnostic
            ? JSON.parse(JSON.stringify(lastAccessDiagnostic))
            : null
    };
}
