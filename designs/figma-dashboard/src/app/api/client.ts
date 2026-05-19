const API_BASE = '';

// JWT token stored in localStorage under 'platform_jwt'
function getAuthHeader(): { Authorization: string } {
  const token = localStorage.getItem('platform_jwt');
  if (token) return { 'Authorization': 'Bearer ' + token };
  return { 'Authorization': '' };
}

// Live auth header — reads JWT from localStorage on every access.
// Import this in pages that make direct fetch() calls.
// The Proxy overrides ownKeys + getOwnPropertyDescriptor so that fetch's
// Headers constructor (which uses Object.entries enumeration) sees the key.
export const AUTH_HEADER = new Proxy({} as { Authorization: string }, {
  get(_t, prop) {
    return getAuthHeader()[prop as 'Authorization'];
  },
  ownKeys() {
    return ['Authorization'];
  },
  getOwnPropertyDescriptor(_t, prop) {
    if (prop === 'Authorization') {
      return { value: getAuthHeader().Authorization, writable: true, enumerable: true, configurable: true };
    }
    return undefined;
  },
});

export const api = {
  // Company Search
  async searchCompanies(params: {
    q?: string;
    sector?: string;
    stage?: string;
    limit?: number;
    offset?: number;
  }) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) qs.append(key, String(value));
    });
    const response = await fetch('/companies/?' + qs.toString(), { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Search failed');
    return response.json();
  },

  // Sourcing
  async getSourcingTargets(params: {
    q?: string;
    sector?: string;
    stage?: string;
    score_min?: number;
    limit?: number;
    offset?: number;
  }) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) qs.append(key, String(value));
    });
    const response = await fetch('/sourcing/?' + qs.toString(), { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Sourcing fetch failed');
    return response.json();
  },

  // Deal Flow
  async getDealFlow() {
    const response = await fetch('/dealflow/', { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Deal flow fetch failed');
    return response.json();
  },

  async updateDealStatus(companyId: string, status: string, reason?: string) {
    const response = await fetch(`/dealflow/${companyId}/status`, {
      method: 'POST',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, reason: reason || undefined })
    });
    if (!response.ok) throw new Error('Status update failed');
    return response.json();
  },

  // Intelligence
  async getIntelligence() {
    const response = await fetch('/intelligence', { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Intelligence fetch failed');
    return response.json();
  },

  async getIntelligenceSector(sector: string) {
    const response = await fetch(`/intelligence/${sector}`, { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Sector intelligence fetch failed');
    return response.json();
  },

  // Portfolio Stats
  async getPortfolioStats() {
    const response = await fetch('/companies', { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Portfolio stats fetch failed');
    return response.json();
  },

  // Partners
  async getPartners(page = 1, per_page = 100) {
    const response = await fetch(`/partners/?page=${page}&per_page=${per_page}`, { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Partners fetch failed');
    return response.json();
  },

  async getPartner(id: number) {
    const response = await fetch(`/partners/${id}`, { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Partner fetch failed');
    return response.json();
  },

  async createPartner(data: {
    name: string;
    industry?: string;
    contact_name?: string;
    contact_email?: string;
    challenge_areas?: string[];
    sectors_of_interest?: string[];
    environments?: string[];
    notes?: string;
  }) {
    const response = await fetch('/partners/', {
      method: 'POST',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Create partner failed');
    return response.json();
  },

  async addMatch(partnerId: number, data: { company_id: number; match_score: number; match_reason: string }) {
    const response = await fetch(`/partners/${partnerId}/matches`, {
      method: 'POST',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Add match failed');
    return response.json();
  },

  async updateMatchStatus(partnerId: number, matchId: number, status: string) {
    const response = await fetch(`/partners/${partnerId}/matches/${matchId}`, {
      method: 'PUT',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) throw new Error('Match status update failed');
    return response.json();
  },

  async getServiceNotes(partnerId: number) {
    const response = await fetch(`/partners/${partnerId}/service-notes`, { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Failed to load service notes');
    return response.json();
  },

  async addServiceNote(partnerId: number, body: string, note_type: string = 'general') {
    const response = await fetch(`/partners/${partnerId}/service-notes`, {
      method: 'POST',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, note_type }),
    });
    if (!response.ok) throw new Error('Add note failed');
    return response.json();
  },

  async deleteServiceNote(partnerId: number, noteId: number) {
    const response = await fetch(`/partners/${partnerId}/service-notes/${noteId}`, {
      method: 'DELETE',
      headers: AUTH_HEADER,
    });
    if (!response.ok) throw new Error('Delete note failed');
    return response.json();
  },

  async listDocuments(partnerId: number) {
    const response = await fetch(`/partners/${partnerId}/documents`, { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('List documents failed');
    return response.json();
  },

  async uploadDocument(partnerId: number, file: File, sourceLabel: string) {
    const form = new FormData();
    form.append('file', file);
    form.append('source_label', sourceLabel);
    const response = await fetch(`/partners/${partnerId}/documents`, {
      method: 'POST',
      headers: AUTH_HEADER,
      body: form,
    });
    if (!response.ok) throw new Error('Upload failed');
    return response.json();
  },

  async getDocumentText(partnerId: number, docId: number) {
    const response = await fetch(`/partners/${partnerId}/documents/${docId}/text`, { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Fetch document text failed');
    return response.json();
  },

  async deletePartner(partnerId: number) {
    const response = await fetch(`/partners/${partnerId}`, {
      method: 'DELETE',
      headers: AUTH_HEADER,
    });
    if (!response.ok) throw new Error('Delete partner failed');
    return response.json();
  },

  async deleteDocument(partnerId: number, docId: number) {
    const response = await fetch(`/partners/${partnerId}/documents/${docId}`, {
      method: 'DELETE',
      headers: AUTH_HEADER,
    });
    if (!response.ok) throw new Error('Delete document failed');
    return response.json();
  },

  async updatePartnerDNA(partnerId: number, data: {
    current_protocols?: string[];
    cloud_platform?: string;
    hardware_vendors?: string[];
    factory_regions?: string[];
    scaling_speed?: 'fast' | 'medium' | 'slow';
    tech_stack?: Record<string, string[]>;
  }) {
    const response = await fetch(`/partners/${partnerId}`, {
      method: 'PATCH',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Partner DNA update failed');
    return response.json();
  },

  async listProblems(partnerId: number) {
    const r = await fetch(`/partners/${partnerId}/problems`, { headers: AUTH_HEADER });
    if (!r.ok) throw new Error('Problems fetch failed');
    return r.json();
  },
  async createProblem(partnerId: number, data: { title: string; description?: string; kpi?: string; confidence_score?: number; status?: string; source?: string }) {
    const r = await fetch(`/partners/${partnerId}/problems`, { method: 'POST', headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!r.ok) throw new Error('Problem create failed');
    return r.json();
  },
  async updateProblem(partnerId: number, problemId: number, data: Partial<{ title: string; description: string; kpi: string; confidence_score: number; status: string; source: string }>) {
    const r = await fetch(`/partners/${partnerId}/problems/${problemId}`, { method: 'PATCH', headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!r.ok) throw new Error('Problem update failed');
    return r.json();
  },
  async deleteProblem(partnerId: number, problemId: number) {
    const r = await fetch(`/partners/${partnerId}/problems/${problemId}`, { method: 'DELETE', headers: AUTH_HEADER });
    if (!r.ok) throw new Error('Problem delete failed');
    return r.json();
  },

  async getCompatibility(partnerId: number, params: { limit?: number; sector?: string; min_score?: number } = {}) {
    const qs = new URLSearchParams();
    if (params.limit)     qs.append('limit',     String(params.limit));
    if (params.sector)    qs.append('sector',    params.sector);
    if (params.min_score) qs.append('min_score', String(params.min_score));
    const response = await fetch(`/partners/${partnerId}/compatibility?${qs}`, { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Compatibility fetch failed');
    return response.json();
  },

  async listAdvisoryLogs(partnerId: number, companyId?: number) {
    const qs = companyId ? `?company_id=${companyId}` : '';
    const response = await fetch(`/partners/${partnerId}/advisory-logs${qs}`, { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Advisory logs fetch failed');
    return response.json();
  },

  async createAdvisoryLog(partnerId: number, data: {
    log_type: string;
    body: string;
    company_id?: number;
    meeting_date?: string;
    outcome?: string;
    next_steps?: string;
    source_url?: string;
  }) {
    const response = await fetch(`/partners/${partnerId}/advisory-logs`, {
      method: 'POST',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Create advisory log failed');
    return response.json();
  },

  async searchPartnerDocs(q: string) {
    const response = await fetch(`/partners/documents/search?q=${encodeURIComponent(q)}`, { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Partner document search failed');
    return response.json();
  },

  async getPartnerContract(partnerId: number) {
    const response = await fetch(`/partners/${partnerId}/contract`, { headers: AUTH_HEADER });
    if (!response.ok) return null;
    return response.json();
  },

  async uploadContract(partnerId: number, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`/partners/${partnerId}/contract`, {
      method: 'POST',
      headers: AUTH_HEADER,
      body: formData,
    });
    if (!response.ok) throw new Error('Contract upload failed');
    return response.json();
  },

  async deleteContract(partnerId: number, contractId: number) {
    const response = await fetch(`/partners/${partnerId}/contract/${contractId}`, {
      method: 'DELETE',
      headers: AUTH_HEADER,
    });
    if (!response.ok) throw new Error('Contract delete failed');
    return response.json();
  },

  async getServiceUsage(partnerId: number, year?: number) {
    const qs = year ? `?year=${year}` : '';
    const response = await fetch(`/partners/${partnerId}/services${qs}`, { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Service usage fetch failed');
    // Returns: { services, canonical_services, available_years, resolved_year }
    return response.json();
  },

  async upsertService(partnerId: number, data: { service_name: string; quantity_included?: number | null; quantity_used?: number; notes?: string; year?: number }) {
    const response = await fetch(`/partners/${partnerId}/services`, {
      method: 'POST',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Service upsert failed');
    return response.json();
  },

  async updateServiceUsage(partnerId: number, serviceId: number, data: { service_name?: string; quantity_included?: number | null; quantity_used?: number; notes?: string; year?: number }) {
    const response = await fetch(`/partners/${partnerId}/services/${serviceId}`, {
      method: 'PATCH',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Service update failed');
    return response.json();
  },

  async deleteService(partnerId: number, serviceId: number) {
    const response = await fetch(`/partners/${partnerId}/services/${serviceId}`, {
      method: 'DELETE',
      headers: AUTH_HEADER,
    });
    if (!response.ok) throw new Error('Service delete failed');
    return response.json();
  },

  async listContacts(partnerId: number) {
    const response = await fetch(`/partners/${partnerId}/contacts`, { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Contacts fetch failed');
    return response.json();
  },

  async addContact(partnerId: number, data: { name: string; title?: string; email?: string; phone?: string; is_primary?: boolean }) {
    const response = await fetch(`/partners/${partnerId}/contacts`, {
      method: 'POST',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Add contact failed');
    return response.json();
  },

  async updateContact(partnerId: number, contactId: number, data: { name?: string; title?: string; email?: string; phone?: string; is_primary?: boolean }) {
    const response = await fetch(`/partners/${partnerId}/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Update contact failed');
    return response.json();
  },

  async deleteContact(partnerId: number, contactId: number) {
    const response = await fetch(`/partners/${partnerId}/contacts/${contactId}`, {
      method: 'DELETE',
      headers: AUTH_HEADER,
    });
    if (!response.ok) throw new Error('Delete contact failed');
    return response.json();
  },

  async updatePartner(partnerId: number, data: { name?: string; industry?: string; contact_name?: string; contact_email?: string; notes?: string; challenge_areas?: string[]; sectors_of_interest?: string[]; membership_level?: string | null; [key: string]: unknown }) {
    const response = await fetch(`/partners/${partnerId}`, {
      method: 'PATCH',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Partner update failed');
    return response.json();
  },

  async patchContract(partnerId: number, data: { value?: number | null; term_end?: string | null }) {
    const response = await fetch(`/partners/${partnerId}/contract/fields`, {
      method: 'PATCH',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Contract update failed');
    return response.json();
  },

  // Shortlists
  async getShortlists() {
    const response = await fetch('/shortlists/', { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Shortlists fetch failed');
    return response.json();
  },

  async createShortlist(name: string) {
    const response = await fetch('/shortlists/', {
      method: 'POST',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) throw new Error('Create shortlist failed');
    return response.json();
  },

  async addToShortlist(shortlistId: number, companyId: number) {
    const response = await fetch(`/shortlists/${shortlistId}/companies`, {
      method: 'POST',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId }),
    });
    if (!response.ok) throw new Error('Add to shortlist failed');
    return response.json();
  },

  async getShortlistCompanies(shortlistId: number) {
    const response = await fetch(`/shortlists/${shortlistId}/companies`, { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Shortlist companies fetch failed');
    return response.json();
  },

  // LP Portal
  async getLPPortal() {
    const response = await fetch('/lp/overview', { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('LP Portal fetch failed');
    return response.json();
  },

  // Company Profile
  async getCompanyProfile(id: string) {
    const response = await fetch(`/companies/${id}`, { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Company profile fetch failed');
    return response.json();
  },

  // Homepage dashboard
  async getDashboard() {
    const response = await fetch('/home/dashboard', { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Dashboard fetch failed');
    return response.json();
  },

  // Home team messages
  async getLeaderboards() {
    const response = await fetch('/home/leaderboards', { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Leaderboards fetch failed');
    return response.json();
  },

  async getMyActivity(): Promise<{ edits: { company_id: number; company_name: string; action: string; ts: string }[] }> {
    const response = await fetch('/home/my-activity', { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('My activity fetch failed');
    return response.json();
  },
  async getTeamMessages() {
    const response = await fetch('/home/messages', { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Messages fetch failed');
    return response.json();
  },
  async postTeamMessage(title: string, body: string, pinned = false) {
    const response = await fetch('/home/messages', {
      method: 'POST',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body, pinned }),
    });
    if (!response.ok) throw new Error('Post message failed');
    return response.json();
  },
  async deleteTeamMessage(id: number) {
    const response = await fetch(`/home/messages/${id}`, { method: 'DELETE', headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Delete message failed');
    return response.json();
  },

  // LLM usage / cost tracking
  async getLLMUsage() {
    const response = await fetch('/intelligence/llm-usage', { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('LLM usage fetch failed');
    return response.json();
  },

  // Auth
  async login(username: string, password: string): Promise<void> {
    const response = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim().toLowerCase(), password }),
    });
    if (!response.ok) throw new Error('Invalid username or password');
    const data = await response.json();
    localStorage.setItem('platform_jwt', data.access_token);
    localStorage.setItem('platform_user', JSON.stringify({ username: data.username, role: data.role, full_name: data.full_name }));
  },

  logout(): void {
    localStorage.removeItem('platform_jwt');
    localStorage.removeItem('platform_user');
  },

  isLoggedIn(): boolean {
    const token = localStorage.getItem('platform_jwt');
    if (!token) return false;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp * 1000 > Date.now();
    } catch {
      return false;
    }
  },

  getCurrentUser(): { username: string; role: string; full_name: string | null } | null {
    const raw = localStorage.getItem('platform_user');
    return raw ? JSON.parse(raw) : null;
  },

  // Issues
  async listIssues(partnerId: number) {
    const response = await fetch(`/partners/${partnerId}/issues`, { headers: AUTH_HEADER });
    return response.json();
  },
  async createIssue(partnerId: number, data: { title: string; body?: string; severity?: string; due_date?: string; linked_document_id?: number }) {
    const response = await fetch(`/partners/${partnerId}/issues`, {
      method: 'POST',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return response.json();
  },
  async updateIssue(partnerId: number, issueId: number, data: Record<string, any>) {
    const response = await fetch(`/partners/${partnerId}/issues/${issueId}`, {
      method: 'PATCH',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return response.json();
  },
  async deleteIssue(partnerId: number, issueId: number) {
    const response = await fetch(`/partners/${partnerId}/issues/${issueId}`, { method: 'DELETE', headers: AUTH_HEADER });
    return response.json();
  },

  async getAllIssues(severity?: string) {
    const qs = severity ? `?severity=${severity}` : '';
    const response = await fetch(`/partners/issues/all${qs}`, { headers: AUTH_HEADER });
    return response.json();
  },

  async listIssueComments(partnerId: number, issueId: number) {
    const response = await fetch(`/partners/${partnerId}/issues/${issueId}/comments`, { headers: AUTH_HEADER });
    return response.json();
  },

  async addIssueComment(partnerId: number, issueId: number, body: string) {
    const response = await fetch(`/partners/${partnerId}/issues/${issueId}/comments`, {
      method: 'POST',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    return response.json();
  },

  // Batch enrichment jobs
  async runBatchEnrichment(data: { job: string; target: string; sector?: string }) {
    const response = await fetch('/admin/enrich/batch', {
      method: 'POST',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  },

  async getLatestBatchJob() {
    const response = await fetch('/admin/enrich/batch/latest', { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Failed to fetch batch job status');
    return response.json();
  },

  // Brave search templates
  async getBraveUsage() {
    const response = await fetch('/admin/brave/usage', { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Failed to fetch Brave usage');
    return response.json();
  },

  async getBraveTemplates() {
    const response = await fetch('/admin/brave/templates', { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Failed to fetch Brave templates');
    return response.json();
  },

  async updateBraveTemplate(id: number, data: { query_template?: string; result_count?: number; active?: boolean; notes?: string }) {
    const response = await fetch(`/admin/brave/templates/${id}`, {
      method: 'PATCH',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to update template');
    return response.json();
  },

  async getBraveStats() {
    const response = await fetch('/admin/brave/stats', { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Failed to fetch Brave stats');
    return response.json();
  },

  // Request documents
  uploadSkirmishDocument: (file: File, sourceLabel?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    if (sourceLabel) fd.append('source_label', sourceLabel);
    return fetch(`${API_BASE}/requests/documents/upload`, {
      method: 'POST',
      headers: AUTH_HEADER,
      body: fd,
    }).then(r => r.json());
  },

  downloadSkirmishDocument: (id: number) =>
    fetch(`${API_BASE}/requests/documents/${id}/download`, { headers: AUTH_HEADER }),

  // Namespace alias for components that call api.admin.*
  get admin() {
    return {
      runBatchEnrichment: this.runBatchEnrichment.bind(this),
      getLatestBatchJob:  this.getLatestBatchJob.bind(this),
      getBraveTemplates:  this.getBraveTemplates.bind(this),
      updateBraveTemplate: this.updateBraveTemplate.bind(this),
      getBraveStats:      this.getBraveStats.bind(this),
    };
  },

  // Namespace alias for components that call api.companies.*
  get companies() {
    return {
      getSectors: async () => {
        const response = await fetch('/companies/sectors', { headers: AUTH_HEADER });
        if (!response.ok) throw new Error('Sectors fetch failed');
        return response.json();
      },
    };
  },

  // ── QQQ Market Intelligence / News ──────────────────────────────────────────
  async getRecentNews(limit = 50): Promise<{ articles: any[]; stats: any }> {
    const response = await fetch(`/news/recent?limit=${limit}`, { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('News fetch failed');
    return response.json();
  },

  async getNewsStats(): Promise<{ totals: any; by_type: any[]; by_company: any[] }> {
    const response = await fetch('/news/stats', { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('News stats failed');
    return response.json();
  },

  async listWatchCompanies(q?: string): Promise<any[]> {
    const qs = q ? `?q=${encodeURIComponent(q)}` : '';
    const response = await fetch(`/news/companies${qs}`, { headers: AUTH_HEADER });
    if (!response.ok) throw new Error('Watch companies fetch failed');
    return response.json();
  },

  async addWatchCompany(company_name: string, ticker?: string): Promise<any> {
    const response = await fetch('/news/companies', {
      method: 'POST',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_name, ticker }),
    });
    if (!response.ok) {
      if (response.status === 409) throw new Error('Company already in watch list');
      throw new Error('Add company failed');
    }
    return response.json();
  },

  async removeWatchCompany(companyId: number): Promise<any> {
    const response = await fetch(`/news/companies/${companyId}`, {
      method: 'DELETE',
      headers: AUTH_HEADER,
    });
    if (!response.ok) throw new Error('Remove company failed');
    return response.json();
  },

  async triggerNewsFetch(): Promise<any> {
    const response = await fetch('/news/fetch', {
      method: 'POST',
      headers: AUTH_HEADER,
    });
    if (!response.ok) throw new Error('Fetch trigger failed');
    return response.json();
  },
}

