import { api, protectedFiles } from "./lib/http";

export { api, protectedFiles };

// Auth
export const auth = {
  login: (username, password) => api.post("/auth/login", { username, password }),
  logout: () => api.post("/auth/logout"),
  me: () => api.get("/auth/me"),
  seed: () => api.get("/auth/seed")
};

// Dashboard
export const dashboard = {
  getAdminSummary: () => api.get("/dashboard/admin-summary"),
  getClientStats: () => api.get("/dashboard/client-stats"),
  getClientActivities: () => api.get("/dashboard/client-activities"),
};

export const client = {
  me: () => api.get("/api/client/me"),
  account: () => api.get("/api/client/account"),
  updateAccount: (data) => api.patch("/api/client/account", data),
  changeAccountPassword: (data) => api.post("/api/client/account/change-password", data),
  accountNotificationPreferences: () => api.get("/api/client/account/notification-preferences"),
  updateAccountNotificationPreferences: (data) => api.put("/api/client/account/notification-preferences", data),
  accountSessions: () => api.get("/api/client/account/sessions"),
  deleteAccountSession: (id) => api.delete(`/api/client/account/sessions/${id}`),
  accountActivity: () => api.get("/api/client/account/activity"),
  dashboard: () => api.get("/api/client/dashboard"),
  companySummary: () => api.get("/api/client/company/summary"),
  company: () => api.get("/api/client/company"),
  updateCompany: (data) => api.patch("/api/client/company", data),
  companyEmployees: () => api.get("/api/client/company/employees"),
  createCompanyEmployee: (data) => api.post("/api/client/company/employees", data),
  updateCompanyEmployee: (id, data) => api.put(`/api/client/company/employees/${id}`, data),
  updateCompanyEmployeeStatus: (id, data) => api.patch(`/api/client/company/employees/${id}/status`, data),
  resetCompanyEmployeePassword: (id) => api.post(`/api/client/company/employees/${id}/reset-password`),
  companyEmployeeSites: (id) => api.get(`/api/client/company/employees/${id}/sites`),
  updateCompanyEmployeeSites: (id, siteIds) => api.put(`/api/client/company/employees/${id}/sites`, { siteIds }),
  companySites: () => api.get("/api/client/company/sites"),
  createCompanySite: (data) => api.post("/api/client/company/sites", data),
  updateCompanySite: (id, data) => api.put(`/api/client/company/sites/${id}`, data),
  deleteCompanySite: (id) => api.delete(`/api/client/company/sites/${id}`),
  companySiteUsers: (id) => api.get(`/api/client/company/sites/${id}/users`),
  updateCompanySiteUsers: (id, userIds) => api.put(`/api/client/company/sites/${id}/users`, { userIds }),
  companyActivity: () => api.get("/api/client/company/activity"),
  offers: () => api.get("/api/client/offers"),
  offer: (id) => api.get(`/api/client/offers/${id}`),
  acceptOffer: (id) => api.post(`/api/client/offers/${id}/accept`),
  rejectOffer: (id, reason = "") => api.post(`/api/client/offers/${id}/reject`, { reason }),
  offerPdf: (id) => api.get(`/pdf/${id}`, { responseType: "blob" }),
  addOfferComment: (id, content) => api.post(`/api/client/offers/${id}/comments`, { content }),
  tickets: (scope = "all") => api.get("/api/client/tickets", {
    params: scope === "all" ? undefined : { scope }
  }),
  orders: () => api.get("/api/client/tickets", { params: { scope: "orders" } }),
  ticket: (id) => api.get(`/api/client/tickets/${id}`),
  createTicket: (data) => api.post("/api/client/tickets", data),
  addTicketComment: (id, content) => api.post(`/api/client/tickets/${id}/comments`, { content }),
  uploadTicketAttachments: (id, files) => {
    const formData = new FormData();
    files.forEach((file) => formData.append("attachments", file));
    return api.post(`/api/client/tickets/${id}/attachments`, formData, {
      headers: { "Content-Type": "multipart/form-data" }
    });
  },
  catalog: () => api.get("/api/client/catalog"),
  sites: () => api.get("/api/client/sites"),
  employees: () => api.get("/api/client/employees")
};

// Offers
export const offers = {
  getAll: () => api.get("/offers"),
  getById: (id) => api.get(`/offers/${id}`),
  create: (data) => api.post("/offers", data),
  update: (id, data) => api.put(`/offers/${id}`, data),
  saveDraft: (id, data) => api.put(`/offers/${id}/draft`, data),
  updateStatus: (id, status) => api.patch(`/offers/${id}/status`, { status }),
  bulkUpdateStatus: (ids, status) => api.patch("/offers/bulk-status", { ids, status }),
  delete: (id) => api.delete(`/offers/${id}`),
  getPDF: (id) => api.get(`/pdf/${id}`, { responseType: "blob" })
};

// System backups
export const backups = {
  getAll: () => api.get("/api/backups"),
  create: () => api.post("/api/backups/create"),
  getSettings: () => api.get("/api/backups/settings"),
  updateSettings: (data) => api.put("/api/backups/settings", data),
  getLocations: () => api.get("/api/backups/locations"),
  createLocation: (data) => api.post("/api/backups/locations", data),
  updateLocation: (id, data) => api.put(`/api/backups/locations/${id}`, data),
  deleteLocation: (id) => api.delete(`/api/backups/locations/${id}`),
  pickLocationFolder: () => api.post("/api/backups/locations/pick-folder"),
  testLocation: (id) => api.post(`/api/backups/locations/${id}/test`),
  importBackup: (file, options = {}) => {
    const formData = new FormData();
    formData.append("backup", file);
    formData.append("integrity", String(options.integrity !== false));
    formData.append("testRestore", String(Boolean(options.testRestore)));
    return api.post("/api/backups/import", formData, {
      headers: { "Content-Type": "multipart/form-data" }
    });
  },
  integrity: (id) => api.post(`/api/backups/${id}/integrity`),
  testRestore: (id) => api.post(`/api/backups/${id}/test-restore`),
  download: (id) => api.get(`/api/backups/${id}/download`, { responseType: "blob" }),
  restore: (id, data) => api.post(`/api/backups/${id}/restore`, data),
  forceRestore: (id, data) => api.post(`/api/backups/${id}/force-restore`, data),
  delete: (id) => api.delete(`/api/backups/${id}`),
  audit: () => api.get("/api/backups/audit")
};

export const system = {
  getStatus: () => api.get("/api/system/status"),
  getNetworkSettings: () => api.get("/api/system/network"),
  updateNetworkSettings: (data) => api.put("/api/system/network", data)
};

export const auditLog = {
  getAll: (params = {}) => api.get("/api/audit", { params }),
  getUsers: () => api.get("/api/audit/users")
};

// Notifications
export const notifications = {
  getAll: (params = {}) => api.get("/api/notifications", { params }),
  getUnreadCount: () => api.get("/api/notifications/unread-count"),
  markRead: (id) => api.put(`/api/notifications/${id}/read`),
  markAllRead: () => api.put("/api/notifications/read-all"),
  delete: (id) => api.delete(`/api/notifications/${id}`),
  getPreferences: () => api.get("/api/notifications/preferences"),
  updatePreferences: (preferences) => api.put("/api/notifications/preferences", { preferences })
};

export const adminOrders = {
  getAll: () => api.get("/api/admin-orders"),
  getAssignees: () => api.get("/api/admin-orders/assignees"),
  getById: (id) => api.get(`/api/admin-orders/${id}`),
  changeStatus: (id, status) => api.patch(`/api/admin-orders/${id}/status`, { status }),
  bulkChangeStatus: (ids, status) => api.patch("/api/admin-orders/bulk-status", { ids, status }),
  changePriority: (id, priority) => api.patch(`/api/admin-orders/${id}/priority`, { priority }),
  assign: (id, adminId) => api.patch(`/api/admin-orders/${id}/assign`, { adminId }),
  addComment: (id, content) => api.post(`/api/admin-orders/${id}/comments`, { content })
};

export const email = {
  getSettings: () => api.get("/api/email/settings"),
  updateSettings: (data) => api.put("/api/email/settings", data),
  getFooter: () => api.get("/api/email/footer"),
  updateFooter: (data) => api.put("/api/email/footer", data),
  uploadFooterLogo: (file) => {
    const formData = new FormData();
    formData.append("logo", file);
    return api.post("/api/email/footer-logo", formData, {
      headers: { "Content-Type": "multipart/form-data" }
    });
  },
  testConnection: () => api.post("/api/email/test-connection"),
  testSend: (data) => api.post("/api/email/test-send", data),
  getTemplates: () => api.get("/api/email/templates"),
  createTemplate: (data) => api.post("/api/email/templates", data),
  updateTemplate: (id, data) => api.put(`/api/email/templates/${id}`, data),
  deleteTemplate: (id) => api.delete(`/api/email/templates/${id}`),
  getLogs: (params) => api.get("/api/email/logs", { params }),
  getLog: (id) => api.get(`/api/email/logs/${id}`),
  sendOffer: (offerId, data) => api.post(`/offers/${offerId}/send-email`, data)
};

// Customers
export const customers = {
  getAll: () => api.get("/customers")
};

// Companies
export const companies = {
  getAll: () => api.get("/companies"),
  getById: (id) => api.get(`/companies/${id}`),
  getUsers: (id) => api.get(`/companies/${id}/users`),
  createUser: (companyId, data) => api.post(`/companies/${companyId}/users`, data),
  updateUser: (companyId, userId, data) => api.put(`/companies/${companyId}/users/${userId}`, data),
  deleteUser: (companyId, userId) => api.delete(`/companies/${companyId}/users/${userId}`),
  getSites: (id) => api.get(`/companies/${id}/sites`),
  createSite: (companyId, data) => api.post(`/companies/${companyId}/sites`, data),
  updateSite: (siteId, data) => api.put(`/objects/${siteId}`, data),
  deleteSite: (siteId) => api.delete(`/objects/${siteId}`),
  getSiteUsers: (siteId) => api.get(`/api/sites/${siteId}/users`),
  updateSiteUsers: (siteId, userIds) => api.put(`/api/sites/${siteId}/users`, { userIds }),
  getOffers: (id) => api.get(`/companies/${id}/offers`),
  getTickets: (id) => api.get(`/companies/${id}/tickets`),
  getOwn: () => api.get("/companies/own"),
  updateOwn: (data) => api.put("/companies/own", data),
  getOwnCompany: () => api.get("/own-company"),
  updateOwnCompany: (data) => api.put("/own-company", data),
  uploadOwnCompanyLogo: (file) => {
    const formData = new FormData();
    formData.append("logo", file);
    return api.post("/uploads/company-logo", formData, {
      headers: { "Content-Type": "multipart/form-data" }
    });
  },
  create: (data) => api.post("/companies", data),
  getMyCompanyData: () => api.get("/companies/my-company"),
  update: (id, data) => api.put(`/companies/${id}`, data),
  delete: (id) => api.delete(`/companies/${id}`)
};

// Products / articles
export const products = {
  getAll: () => api.get("/products"),
  getCategories: () => api.get("/products/categories"),
  createCategory: (data) => api.post("/products/categories", data),
  deleteCategory: (id) => api.delete(`/products/categories/${id}`),
  uploadImage: (file) => {
    const formData = new FormData();
    formData.append("image", file);
    return api.post("/products/upload-image", formData, {
      headers: { "Content-Type": "multipart/form-data" }
    });
  },
  create: (data) => api.post("/products", data),
  update: (id, data) => api.put(`/products/${id}`, data),
  duplicate: (id) => api.post(`/products/${id}/duplicate`),
  delete: (id) => api.delete(`/products/${id}`)
};

// Objects
export const objects = {
  getAll: () => api.get("/objects"),
  getByCompany: (companyId) => api.get(`/objects/company/${companyId}`),
  getById: (id) => api.get(`/objects/${id}`),
  create: (data) => api.post("/objects", data),
  update: (id, data) => api.put(`/objects/${id}`, data),
  delete: (id) => api.delete(`/objects/${id}`)
};

// Tickets
export const tickets = {
  getAll: () => api.get("/tickets"),
  getById: (id) => api.get(`/tickets/${id}`),
  update: (id, data) => api.put(`/tickets/${id}`, data),
  getAssignableAdmins: () => api.get("/tickets/assignees/admins"),
  assignAdmin: (id, adminId) => api.post(`/tickets/${id}/assign`, { adminId }),
  changeStatus: (id, payload) => api.post(`/tickets/${id}/change-status`, typeof payload === "string" ? { status: payload } : payload),
  bulkChangeStatus: (ids, status) => api.post("/tickets/bulk-change-status", { ids, status }),
  changePriority: (id, priority) => api.post(`/tickets/${id}/change-priority`, { priority }),
  close: (id, data) => api.post(`/tickets/${id}/close`, data),
  addComment: (id, data) => {
    const { attachments = [], ...comment } = data || {};
    if (!attachments.length) return api.post(`/tickets/${id}/comments`, comment);

    const formData = new FormData();
    formData.append("content", comment.content || "");
    formData.append("isInternal", String(Boolean(comment.isInternal)));
    attachments.forEach((file) => formData.append("attachments", file));
    return api.post(`/tickets/${id}/comments`, formData, {
      headers: { "Content-Type": "multipart/form-data" }
    });
  },
  uploadAttachments: (id, files, visibility = "PUBLIC") => {
    const formData = new FormData();
    files.forEach((file) => formData.append("attachments", file));
    formData.append("visibility", visibility);
    return api.post(`/tickets/${id}/attachments`, formData, {
      headers: { "Content-Type": "multipart/form-data" }
    });
  },
  deleteAttachment: (id, attachmentId) => api.delete(`/tickets/${id}/attachments/${attachmentId}`),
  getHistory: (id) => api.get(`/tickets/${id}/history`),
  getOffers: (id) => api.get(`/tickets/${id}/offers`),
  getAvailableOffers: (id) => api.get(`/tickets/${id}/available-offers`),
  linkOffer: (id, offerId) => api.post(`/tickets/${id}/offers/${offerId}`),
  createOfferDraft: (id) => api.post(`/tickets/${id}/create-offer-draft`),
  create: (data) => {
    const formData = new FormData();
    Object.keys(data).forEach(key => {
      if (key === 'photos') {
        data.photos.forEach(photo => {
          formData.append('photos', photo);
        });
      } else {
        formData.append(key, data[key]);
      }
    });
    return api.post("/tickets", formData, {
      headers: { "Content-Type": "multipart/form-data" }
    });
  }
};

// Comments
export const comments = {
  getByOffer: (offerId) => api.get(`/comments/offer/${offerId}`),
  create: (data) => api.post("/comments", data),
  delete: (id) => api.delete(`/comments/${id}`)
};

// Rejections
export const rejections = {
  getByOffer: (offerId) => api.get(`/rejections/offer/${offerId}`),
  create: (data) => api.post("/rejections", data)
};

// Templates
export const templates = {
  getAll: () => api.get("/templates"),
  getById: (id) => api.get(`/templates/${id}`),
  create: (data) => api.post("/templates", data),
  delete: (id) => api.delete(`/templates/${id}`),
};

// Photos
export const photos = {
  getByOffer: (offerId) => api.get(`/photos/offer/${offerId}`),
  upload: (offerId, file) => {
    const formData = new FormData();
    formData.append("offer_id", offerId);
    formData.append("photo", file);
    return api.post("/photos/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" }
    });
  },
  delete: (id) => api.delete(`/photos/${id}`)
};

// Admin
export const admin = {
  getStats: () => api.get("/admin/stats"),
  getUsers: () => api.get("/admin/users"),
  createUser: (data) => api.post("/admin/users", data),
  updateUserRole: (id, role) => api.put(`/admin/users/${id}`, { role }),
  deleteUser: (id) => api.delete(`/admin/users/${id}`),
  getActivities: () => api.get("/admin/activities")
};

// Users
export const users = {
  getAll: () => api.get("/users"),
  changePassword: (data) => api.put("/users/change-password", data),
  updatePermissions: (userId, permissions) => api.put(`/users/${userId}/permissions`, { permissions }),
  updateSites: (userId, siteIds) => api.put(`/users/${userId}/sites`, { siteIds })
};

export const admins = {
  getAll: () => api.get("/admins"),
  create: (data) => api.post("/admins", data),
  update: (id, data) => api.put(`/admins/${id}`, data),
  delete: (id) => api.delete(`/admins/${id}`)
};

export const search = {
  query: (q) => api.get("/api/search", { params: { q }, skipGlobalFeedback: true })
};
