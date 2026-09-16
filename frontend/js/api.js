// Shared JSON client. Load before page scripts that use `api`.
window.api = (() => {
    async function request(method, path, body) {
        const options = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
        if (body !== undefined) {
            if (body instanceof FormData) {
                options.body = body;
            } else {
                options.headers['Content-Type'] = 'application/json';
                options.body = JSON.stringify(body);
            }
        }
        let response;
        try {
            response = await fetch(path, options);
        } catch {
            throw new Error('Unable to reach the server. Check your connection and try again.');
        }
        const text = await response.text();
        let data = {};
        if (text) {
            try { data = JSON.parse(text); }
            catch { throw new Error(`The server returned an unexpected response (${response.status}).`); }
        }
        if (!response.ok) {
            const error = new Error(data.message || `Request failed (${response.status}).`);
            error.status = response.status;
            error.code = data.code;
            throw error;
        }
        return data;
    }
    return {
        get: (path) => request('GET', path),
        post: (path, body) => request('POST', path, body),
        put: (path, body) => request('PUT', path, body),
        del: (path) => request('DELETE', path),
    };
})();
