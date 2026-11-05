window.__ModuleLoader__.load({
	id: "dsh-remote-huaweicloud-devbridge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");

/* ===== inline web/panel.js (source of truth, do not edit this block) ===== */
/*__PANEL_JS__*/
/* ===== end inline ===== */

		/**
		 * 侧边栏底部席位。面板用自包含浮层，不依赖 sidebarRight 服务，
		 * 因此在 web / desktop / 老版本 DSH 上都能挂出来。
		 */
		function mountSeatUI(ctx) {
			const slots = ctx && ctx.slots;
			if (!slots || typeof slots.inject !== "function") {
				console.warn("[devbridge-remote] slots service unavailable; seat not mounted");
				return false;
			}
			function Seat() {
				const ref = React.useRef(null);
				React.useEffect(() => {
					if (!ref.current) return undefined;
					let unmount = null;
					try {
						unmount = window.DevBridgePanel.mountSeat(ref.current, {});
					} catch (e) {
						console.error("[devbridge-remote] seat mount failed:", e);
					}
					return () => { try { if (unmount) unmount(); } catch (e) { /* noop */ } };
				}, []);
				return React.createElement("div", { ref: ref, className: "dbr-seat-host" });
			}
			try {
				slots.inject("sidebar.footer.action", () => slots.register(
					{ name: "sidebar.footer.action", id: "dsh-remote-huaweicloud-devbridge", order: 85 },
					Seat
				));
				return true;
			} catch (e) {
				console.error("[devbridge-remote] seat registration failed:", e);
				return false;
			}
		}

		function apply(ctx) {
			mountSeatUI(ctx);
		}
		apply.inject = ["slots"];

		exports.apply = apply;
		exports.inject = ["slots"];
		return module.exports;
	}
});
