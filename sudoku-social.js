/* ═══════════════════════════════════════════════════════════
   SZ.Social — Leaderboards, profile, ratings, comments, sync.
   Purely additive: does not modify SZ.state, SZ.Engine,
   SZ.Stats, SZ.Achievements, or SZ.Challenges. Every public
   method fails soft — if Supabase is unreachable, the game
   keeps working exactly as it does today.
   ═══════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  // ─── Configuration ────────────────────────────────────────
  const SUPABASE_URL = "https://uwoydzphaykxinsclqnb.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_S2jXQ87IMU7BPvQW1c4kpw_5SI5EdQA";
  const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

  window.SZ = window.SZ || {};
  const SZ = window.SZ;

  SZ.Social = {
    enabled: true,          // flips to false if init fails
    _client: null,
    _queueKey: "sz-social-sync-queue",

    // ═══ Setup ═══
    init() {
      try {
        if (!window.supabase || !window.supabase.createClient) {
          console.warn("[SZ.Social] supabase-js not loaded — social features disabled.");
          this.enabled = false;
          return;
        }
        this._client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        SZ.Social.Player.ensure();
        window.addEventListener("online", () => SZ.Social.Sync.flush());
        // Opportunistic flush shortly after load in case we came back online
        // while the tab was closed.
        setTimeout(() => SZ.Social.Sync.flush(), 2000);
      } catch (e) {
        console.warn("[SZ.Social] init failed, running offline:", e);
        this.enabled = false;
      }
    },

    get client() {
      return this._client;
    },

    isOnline() {
      return this.enabled && navigator.onLine;
    },

    // ═══ Player Profile Manager ═══
    Player: {
      KEY_DEVICE: "sz-social-device-id",
      KEY_NICK: "sz-social-nickname",

      ensure() {
        if (!this.getDeviceId()) {
          localStorage.setItem(this.KEY_DEVICE, crypto.randomUUID());
        }
        return { deviceId: this.getDeviceId(), nickname: this.getNickname() };
      },

      getDeviceId() {
        return localStorage.getItem(this.KEY_DEVICE);
      },

      getNickname() {
        return localStorage.getItem(this.KEY_NICK) || "";
      },

      hasNickname() {
        return !!this.getNickname();
      },

      setNickname(name) {
        const clean = String(name).trim().slice(0, 20);
        if (!clean) return false;
        localStorage.setItem(this.KEY_NICK, clean);
        return true;
      },

      /** Local aggregate profile view, built from SZ.Stats + SZ.Challenges
       *  (both already exist) plus social-specific extras. Nothing here
       *  requires a network call — it's a read of what's already local. */
      getLocalSummary() {
        const stats = SZ.Stats && SZ.Stats.get ? SZ.Stats.get() : {};
        const challengeRecords = SZ.Challenges && SZ.Challenges.getRecords
          ? SZ.Challenges.getRecords() : {};
        const dailyCompleted = Object.keys(challengeRecords)
          .filter(k => k.startsWith("daily_") && challengeRecords[k].completed).length;
        return { nickname: this.getNickname(), stats, dailyCompleted };
      },
    },

    // ═══ Leaderboard Manager ═══
    Leaderboard: {
      _cache: new Map(),
      _cacheTTL: 30_000, // 30s — avoid hammering the DB on every tab open

      /** period: 'today' | 'week' | 'month' | 'alltime' */
      async fetch(period, difficulty, limit = 50) {
        const cacheKey = `${period}_${difficulty}_${limit}`;
        const cached = this._cache.get(cacheKey);
        if (cached && Date.now() - cached.at < this._cacheTTL) return cached.data;

        if (!SZ.Social.isOnline()) return { rows: [], offline: true };

        try {
          const { start, end } = this._rangeFor(period);
          let rows;
          if (period === "today") {
            const { data, error } = await SZ.Social.client
              .from("leaderboard_daily")
              .select("nickname,time_seconds,mistakes,hints_used,completed_at")
              .eq("puzzle_date", start)
              .eq("difficulty", difficulty)
              .order("time_seconds", { ascending: true })
              .order("mistakes", { ascending: true })
              .order("hints_used", { ascending: true })
              .order("completed_at", { ascending: true })
              .limit(limit);
            if (error) throw error;
            rows = data;
          } else {
            const { data, error } = await SZ.Social.client.rpc("get_leaderboard", {
              p_start: start, p_end: end, p_difficulty: difficulty, p_limit: limit,
            });
            if (error) throw error;
            rows = data;
          }
          const result = { rows: rows || [], offline: false };
          this._cache.set(cacheKey, { at: Date.now(), data: result });
          return result;
        } catch (e) {
          console.warn("[SZ.Social.Leaderboard] fetch failed:", e);
          return { rows: [], offline: true };
        }
      },

      _rangeFor(period) {
        const today = new Date();
        const iso = (d) => d.toISOString().slice(0, 10);
        if (period === "today") return { start: iso(today), end: iso(today) };
        if (period === "week") {
          const d = new Date(today);
          d.setDate(d.getDate() - 7);
          return { start: iso(d), end: iso(today) };
        }
        if (period === "month") {
          const d = new Date(today);
          d.setDate(d.getDate() - 30);
          return { start: iso(d), end: iso(today) };
        }
        return { start: "2020-01-01", end: iso(today) }; // alltime
      },

      invalidateCache() {
        this._cache.clear();
      },
    },

    // ═══ Daily Challenge attempt flow (the anti-cheat core) ═══
    DailyAttempt: {
      _tokenKey: "sz-social-attempt-token",

      /** Call right when the player STARTS the daily puzzle
       *  (i.e. from inside/after SZ.Challenges.startDaily()). */
      async start(dateStr, difficulty, puzzle) {
        if (!SZ.Social.isOnline()) return null;
        SZ.Social.Player.ensure();
        const givens = {};
        puzzle.forEach((v, i) => { if (v) givens[i] = v; });

        try {
          const res = await fetch(`${FUNCTIONS_URL}/start-attempt`, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
            body: JSON.stringify({
              device_id: SZ.Social.Player.getDeviceId(),
              nickname: SZ.Social.Player.getNickname() || "Anonymous",
              puzzle_date: dateStr,
              difficulty,
              givens,
            }),
          });
          const data = await res.json();
          if (!res.ok) { console.warn("[SZ.Social] start-attempt:", data.error); return null; }
          sessionStorage.setItem(this._tokenKey, data.attempt_token);
          return data.attempt_token;
        } catch (e) {
          console.warn("[SZ.Social] start-attempt failed (offline mode):", e);
          return null;
        }
      },

      /** Call right when the daily puzzle is solved
       *  (from inside SZ.UI.checkWin(), only when challengeType === 'daily'). */
      async complete(grid, mistakes, hintsUsed) {
        const token = sessionStorage.getItem(this._tokenKey);
        if (!token) return null; // no server attempt (started offline) — nothing to submit

        if (!SZ.Social.isOnline()) {
          SZ.Social.Sync.queueCompletion(token, grid, mistakes, hintsUsed);
          return null;
        }
        try {
          const res = await fetch(`${FUNCTIONS_URL}/complete-attempt`, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
            body: JSON.stringify({ attempt_token: token, grid, mistakes, hints_used: hintsUsed }),
          });
          const data = await res.json();
          if (!res.ok) { console.warn("[SZ.Social] complete-attempt:", data.error); return null; }
          sessionStorage.removeItem(this._tokenKey);
          SZ.Social.Leaderboard.invalidateCache();
          return data; // { time_seconds, rank_today }
        } catch (e) {
          console.warn("[SZ.Social] complete-attempt failed, queuing for later:", e);
          SZ.Social.Sync.queueCompletion(token, grid, mistakes, hintsUsed);
          return null;
        }
      },
    },

    // ═══ Rating Manager ═══
    Rating: {
      async submit(puzzleId, stars) {
        SZ.Social.Player.ensure();
        const player = await SZ.Social._resolvePlayerId();
        if (!player) { this._queueLocal("rating", { puzzleId, stars }); return false; }
        if (!SZ.Social.isOnline()) { this._queueLocal("rating", { puzzleId, stars }); return false; }

        try {
          const { error } = await SZ.Social.client
            .from("puzzle_ratings")
            .insert({ player_id: player, puzzle_id: puzzleId, rating: stars });
          if (error) {
            if (error.code === "23505") return "already_rated"; // unique violation
            throw error;
          }
          return true;
        } catch (e) {
          console.warn("[SZ.Social.Rating] submit failed, queued:", e);
          this._queueLocal("rating", { puzzleId, stars });
          return false;
        }
      },

      async average(puzzleId) {
        if (!SZ.Social.isOnline()) return null;
        try {
          const { data, error } = await SZ.Social.client
            .from("puzzle_rating_summary")
            .select("avg_rating,rating_count")
            .eq("puzzle_id", puzzleId)
            .maybeSingle();
          if (error) throw error;
          return data; // { avg_rating, rating_count } or null if no ratings yet
        } catch (e) {
          console.warn("[SZ.Social.Rating] average fetch failed:", e);
          return null;
        }
      },

      _queueLocal(type, payload) {
        SZ.Social.Sync.enqueue(type, payload);
      },
    },

    // ═══ Comment Manager ═══
    Comment: {
      async submit(puzzleId, text) {
        const clean = String(text).trim().slice(0, 200);
        if (!clean) return false;
        const player = await SZ.Social._resolvePlayerId();
        if (!player || !SZ.Social.isOnline()) {
          SZ.Social.Sync.enqueue("comment", { puzzleId, text: clean });
          return false;
        }
        try {
          const { error } = await SZ.Social.client
            .from("puzzle_comments")
            .insert({ player_id: player, puzzle_id: puzzleId, comment: clean });
          if (error) {
            if (error.code === "23505") return "already_commented";
            throw error;
          }
          return true;
        } catch (e) {
          console.warn("[SZ.Social.Comment] submit failed, queued:", e);
          SZ.Social.Sync.enqueue("comment", { puzzleId, text: clean });
          return false;
        }
      },

      async list(puzzleId, limit = 30) {
        if (!SZ.Social.isOnline()) return [];
        try {
          const { data, error } = await SZ.Social.client
            .from("puzzle_comments")
            .select("comment,created_at,players(nickname)")
            .eq("puzzle_id", puzzleId)
            .order("created_at", { ascending: false })
            .limit(limit);
          if (error) throw error;
          return (data || []).map(r => ({
            nickname: r.players?.nickname || "Anonymous",
            comment: r.comment,
            createdAt: r.created_at,
          }));
        } catch (e) {
          console.warn("[SZ.Social.Comment] list failed:", e);
          return [];
        }
      },
    },

    // ═══ Statistics Manager (global/community panel) ═══
    Statistics: {
      async global() {
        if (!SZ.Social.isOnline()) return null;
        try {
          const { data, error } = await SZ.Social.client.rpc("get_global_stats");
          if (error) throw error;
          return data && data[0] ? data[0] : null;
        } catch (e) {
          console.warn("[SZ.Social.Statistics] fetch failed:", e);
          return null;
        }
      },
    },

    // ═══ Cloud Sync Manager (offline queue) ═══
    Sync: {
      _get() {
        try { return JSON.parse(localStorage.getItem(SZ.Social._queueKey)) || []; }
        catch (e) { return []; }
      },
      _set(q) { localStorage.setItem(SZ.Social._queueKey, JSON.stringify(q)); },

      enqueue(type, payload) {
        const q = this._get();
        q.push({ type, payload, queuedAt: Date.now() });
        this._set(q);
      },

      queueCompletion(token, grid, mistakes, hintsUsed) {
        this.enqueue("completion", { token, grid, mistakes, hintsUsed });
      },

      async flush() {
        if (!SZ.Social.isOnline()) return;
        let q = this._get();
        if (!q.length) return;
        const remaining = [];

        for (const item of q) {
          try {
            if (item.type === "rating") {
              const r = await SZ.Social.Rating.submit(item.payload.puzzleId, item.payload.stars);
              if (r === false) remaining.push(item);
            } else if (item.type === "comment") {
              const r = await SZ.Social.Comment.submit(item.payload.puzzleId, item.payload.text);
              if (r === false) remaining.push(item);
            } else if (item.type === "completion") {
              const res = await fetch(`${FUNCTIONS_URL}/complete-attempt`, {
                method: "POST",
                headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
                body: JSON.stringify({
                  attempt_token: item.payload.token,
                  grid: item.payload.grid,
                  mistakes: item.payload.mistakes,
                  hints_used: item.payload.hintsUsed,
                }),
              });
              if (!res.ok) remaining.push(item);
            }
          } catch (e) {
            remaining.push(item); // keep for next retry
          }
        }
        this._set(remaining);
        if (remaining.length !== q.length) SZ.Social.Leaderboard.invalidateCache();
      },
    },

    // ═══ Internal helper: resolve/create the Supabase player row id.
    //     Cached in localStorage after the first successful lookup so
    //     we don't round-trip on every rating/comment. ═══
    async _resolvePlayerId() {
      const cached = localStorage.getItem("sz-social-player-id");
      if (cached) return cached;
      if (!this.isOnline()) return null;
      try {
        const deviceId = this.Player.getDeviceId();
        const nickname = this.Player.getNickname() || "Anonymous";
        const { data, error } = await this.client
          .from("players")
          .upsert({ device_id: deviceId, nickname }, { onConflict: "device_id" })
          .select("id")
          .single();
        if (error) throw error;
        localStorage.setItem("sz-social-player-id", data.id);
        return data.id;
      } catch (e) {
        console.warn("[SZ.Social] player resolve failed:", e);
        return null;
      }
    },
  };

  // Auto-init once the DOM + existing SZ modules are ready.
  document.addEventListener("DOMContentLoaded", () => SZ.Social.init());
})();
