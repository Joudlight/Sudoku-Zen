/* ═══════════════════════════════════════════════════════════
   SZ.SocialUI — DOM glue for SZ.Social. Pure presentation:
   renders overlays, wires clicks, formats numbers. All actual
   data/network logic lives in SZ.Social (sudoku-social.js).
   ═══════════════════════════════════════════════════════════ */

(function () {
  "use strict";
  window.SZ = window.SZ || {};
  const SZ = window.SZ;

  SZ.SocialUI = {
    _pendingRating: null, // { puzzleId, difficulty }

    // ═══ Nickname prompt ═══
    promptNickname(isEditing = false) {
      const current = SZ.Social.Player.getNickname();
      const name = window.prompt(
        isEditing ? "Change your nickname:" : "Choose a nickname for leaderboards:",
        current || ""
      );
      if (name === null) return; // cancelled
      const trimmed = name.trim();
      if (!trimmed) return;
      SZ.Social.Player.setNickname(trimmed);
      if (SZ.UI && SZ.UI.showToast) SZ.UI.showToast(`Nickname set to "${trimmed.slice(0, 20)}"`);
    },

    // ═══ Leaderboard rendering ═══
    async renderLeaderboard(period = "today") {
      const list = document.getElementById("leaderboardList");
      const difficulty = (SZ.state && SZ.state.difficulty) || "medium";
      list.innerHTML = '<div class="lb-empty">Loading…</div>';

      const { rows, offline } = await SZ.Social.Leaderboard.fetch(period, difficulty, 50);

      if (offline) {
        list.innerHTML = '<div class="lb-empty">Offline — leaderboard unavailable right now.</div>';
        return;
      }
      if (!rows.length) {
        list.innerHTML = '<div class="lb-empty">No scores yet for this period. Be the first!</div>';
        return;
      }

      const myNick = SZ.Social.Player.getNickname();
      list.innerHTML = rows.map((r, i) => {
        const isMe = r.nickname === myNick;
        const date = r.completed_at ? new Date(r.completed_at).toLocaleDateString() : "";
        return `
          <div class="lb-row ${isMe ? "me" : ""}">
            <span>#${i + 1}</span>
            <span>${this._escape(r.nickname)}</span>
            <span>${SZ.UI.formatTime(r.time_seconds)} · ${r.mistakes}✗ · ${r.hints_used}💡</span>
          </div>`;
      }).join("");
    },

    _wireLeaderboardTabs() {
      const tabs = document.getElementById("lbTabs");
      if (!tabs || tabs._wired) return;
      tabs._wired = true;
      tabs.addEventListener("click", (e) => {
        const btn = e.target.closest(".lb-tab");
        if (!btn) return;
        tabs.querySelectorAll(".lb-tab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this.renderLeaderboard(btn.dataset.period);
      });
      const closeBtn = document.getElementById("closeLeaderboardBtn");
      if (closeBtn) closeBtn.addEventListener("click", () => SZ.UI.hideOverlay("leaderboardOverlay"));
    },

    // ═══ Rank toast after a Daily Challenge submit ═══
    showRankToast(rank, timeSeconds) {
      if (!rank || !SZ.UI || !SZ.UI.showToast) return;
      const suffix = rank === 1 ? "🥇 #1 today!" : `#${rank} today`;
      SZ.UI.showToast(`Score submitted — ${suffix} (${SZ.UI.formatTime(timeSeconds)})`);
    },

    // ═══ Rating prompt (shown after win screen closes) ═══
    queuePendingRating(puzzleId, difficulty) {
      this._pendingRating = { puzzleId, difficulty };
      // Show shortly after the win overlay so it doesn't compete with confetti.
      setTimeout(() => this._showRatingOverlay(), 1800);
    },

    _showRatingOverlay() {
      if (!this._pendingRating || !SZ.Social || !SZ.Social.isOnline()) return;
      const picker = document.getElementById("starPicker");
      const submitBtn = document.getElementById("submitRatingBtn");
      const skipBtn = document.getElementById("skipRatingBtn");
      let selected = 0;

      const paint = () => {
        picker.querySelectorAll("span").forEach(s => {
          s.textContent = Number(s.dataset.star) <= selected ? "★" : "☆";
          s.classList.toggle("filled", Number(s.dataset.star) <= selected);
        });
        submitBtn.disabled = selected === 0;
      };

      if (!picker._wired) {
        picker._wired = true;
        picker.addEventListener("click", (e) => {
          const star = e.target.closest("[data-star]");
          if (!star) return;
          selected = Number(star.dataset.star);
          paint();
        });
      }
      selected = 0;
      paint();

      submitBtn.onclick = async () => {
        const { puzzleId } = this._pendingRating;
        SZ.UI.hideOverlay("ratePuzzleOverlay");
        const result = await SZ.Social.Rating.submit(puzzleId, selected);
        if (result === "already_rated") {
          SZ.UI.showToast("You already rated this puzzle");
        } else if (result === true) {
          SZ.UI.showToast("Thanks for rating!");
        } else {
          SZ.UI.showToast("Rating saved — will sync when back online");
        }
        this._pendingRating = null;
      };
      skipBtn.onclick = () => {
        SZ.UI.hideOverlay("ratePuzzleOverlay");
        this._pendingRating = null;
      };

      SZ.UI.showOverlay("ratePuzzleOverlay");
    },

    _escape(s) {
      const div = document.createElement("div");
      div.textContent = s;
      return div.innerHTML;
    },

    init() {
      this._wireLeaderboardTabs();
    },
  };

  document.addEventListener("DOMContentLoaded", () => SZ.SocialUI.init());
})();
