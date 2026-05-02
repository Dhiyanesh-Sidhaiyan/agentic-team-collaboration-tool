const request = require('supertest');
const { app, store } = require('../server');

describe('Colliq API Tests', () => {

    // ── Health ─────────────────────────────
    describe('GET /api/health', () => {
        it('should return status ok', async () => {
            const res = await request(app).get('/api/health');
            expect(res.statusCode).toBe(200);
            expect(res.body.status).toBe('ok');
        });
    });

    // ── Channels ───────────────────────────
    describe('Channels API', () => {

        it('should fetch all channels', async () => {
            const res = await request(app).get('/api/channels');
            expect(res.statusCode).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it('should create a new channel', async () => {
            const res = await request(app)
                .post('/api/channels')
                .send({ name: 'test-channel' });

            expect(res.statusCode).toBe(201);
            expect(res.body.name).toBe('test-channel');
        });

        it('should not allow duplicate channel', async () => {
            await request(app).post('/api/channels').send({ name: 'dup-channel' });
            const res = await request(app).post('/api/channels').send({ name: 'dup-channel' });

            expect(res.statusCode).toBe(409);
        });

        it('should validate channel name length', async () => {
            const res = await request(app)
                .post('/api/channels')
                .send({ name: '' });

            expect(res.statusCode).toBe(400);
        });

    });

    // ── Messages ───────────────────────────
    describe('Messages API', () => {

        it('should return messages for valid channel', async () => {
            const res = await request(app).get('/api/channels/general/messages');
            expect(res.statusCode).toBe(200);
        });

        it('should return 404 for invalid channel', async () => {
            const res = await request(app).get('/api/channels/unknown/messages');
            expect(res.statusCode).toBe(404);
        });

        it('should send message', async () => {
            const res = await request(app)
                .post('/api/channels/general/messages')
                .send({ text: 'Hello world', user: 'Tester' });

            expect(res.statusCode).toBe(201);
            expect(res.body.text).toBe('Hello world');
        });

        it('should validate empty message', async () => {
            const res = await request(app)
                .post('/api/channels/general/messages')
                .send({ text: '' });

            expect(res.statusCode).toBe(400);
        });

    });

    // ── Tasks ──────────────────────────────
    describe('Tasks API', () => {

        it('should fetch tasks', async () => {
            const res = await request(app).get('/api/tasks');
            expect(res.statusCode).toBe(200);
        });

        it('should create task', async () => {
            const res = await request(app)
                .post('/api/tasks')
                .send({ text: 'New Task' });

            expect(res.statusCode).toBe(201);
            expect(res.body.status).toBe('pending');
        });

        it('should update task', async () => {
            const task = store.tasks[0];

            const res = await request(app)
                .patch(`/api/tasks/${task.id}`)
                .send({ status: 'completed' });

            expect(res.statusCode).toBe(200);
            expect(res.body.status).toBe('completed');
        });

        it('should delete task', async () => {
            const task = store.tasks[0];

            const res = await request(app)
                .delete(`/api/tasks/${task.id}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.deleted).toBe(true);
        });

        it('should return 404 for invalid task', async () => {
            const res = await request(app)
                .patch('/api/tasks/invalid-id')
                .send({ status: 'completed' });

            expect(res.statusCode).toBe(404);
        });

    });

    // ── Files ──────────────────────────────
    describe('Files API', () => {

        it('should fetch files', async () => {
            const res = await request(app).get('/api/files');
            expect(res.statusCode).toBe(200);
        });

        it('should upload file metadata', async () => {
            const res = await request(app)
                .post('/api/upload')
                .send({ name: 'test.txt', size: '1KB' });

            expect(res.statusCode).toBe(200);
            expect(res.body.name).toBe('test.txt');
        });

    });

    // ── Docs ───────────────────────────────
    describe('Docs API', () => {

        it('should return docs list', async () => {
            const res = await request(app).get('/api/docs');
            expect(res.statusCode).toBe(200);
        });

        it('should reject invalid doc URL', async () => {
            const res = await request(app)
                .get('/api/docs/preview')
                .query({ url: 'invalid-url' });

            expect(res.statusCode).toBe(400);
        });

    });

    // ── Workflows ──────────────────────────
    describe('Workflows API', () => {

        it('should fetch workflows', async () => {
            const res = await request(app).get('/api/workflows');
            expect(res.statusCode).toBe(200);
        });

        it('should create workflow', async () => {
            const res = await request(app)
                .post('/api/workflows')
                .send({ name: 'Test Workflow' });

            expect(res.statusCode).toBe(201);
            expect(res.body.name).toBe('Test Workflow');
        });

        it('should validate workflow name', async () => {
            const res = await request(app)
                .post('/api/workflows')
                .send({ name: '' });

            expect(res.statusCode).toBe(400);
        });

    });

    // ── Search ─────────────────────────────
    describe('Search API', () => {

        it('should return empty results for no query', async () => {
            const res = await request(app).get('/api/search');
            expect(res.statusCode).toBe(200);
            expect(res.body.messages).toEqual([]);
        });

        it('should return results for valid query', async () => {
            const res = await request(app)
                .get('/api/search')
                .query({ q: 'cloud' });

            expect(res.statusCode).toBe(200);
        });

    });

});