export const CLIENT_OWNER = "CLIENT_OWNER";
export const CLIENT_EMPLOYEE = "CLIENT_EMPLOYEE";

export function isClientRole(role) {
  return [CLIENT_OWNER, CLIENT_EMPLOYEE, "USER"].includes(role);
}

export function isClientOwner(user) {
  return user?.role === CLIENT_OWNER;
}

export function hasClientPermission(user, permission) {
  if (user?.role === "ADMIN" || isClientOwner(user)) return true;
  return Array.isArray(user?.permissions) && user.permissions.includes(permission);
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    return null;
  }
}
