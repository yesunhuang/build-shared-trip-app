// Per-day forecast place editor (owner and content managers only; the trip page never builds it
// for viewers and the server refuses viewer writes regardless).
//
// Builds DOM only. The caller supplies the current association, the saved points that may be
// chosen (coordinates already saved on plans or as weather locations) and an async onSave(choice)
// that performs the validated, version-checked write and reports
//   "saved" | "conflict" | "forbidden" | "invalid" | "offline" | "error".
// Typed coordinates are validated locally (parseCoordinateEntry) and again by the server. Nothing
// here geocodes or searches: a place is either a saved point or explicitly typed coordinates.
import { parseCoordinateEntry, pointKey } from "./weather-association.js?v=v-a658691789ff";

export const WEATHER_EDITOR_LANGUAGES = Object.freeze(["en", "zh-Hans", "zh-Hant", "ja"]);

const TEXT = Object.freeze({
  en: {
    change: "Change forecast places",
    title: "Forecast places for this day",
    legend: "Where should this day's forecast come from?",
    modeAuto: "Automatic, from this day's saved plan locations",
    modeManual: "Choose places",
    modeOff: "No forecast for this day",
    nowAuto: "Now: automatic · {count} area(s)",
    nowAutoNone: "Now: automatic · no saved plan locations yet",
    nowManual: "Now: chosen places · {count}",
    nowOff: "Now: no forecast for this day",
    autoPreview: "Areas found from saved plan locations",
    autoNone: "No plan on this day has saved coordinates yet, so there is no automatic forecast.",
    stops: "{count} stop(s)",
    areaNear: "Area near {place}",
    area: "Area {number}",
    chosen: "Chosen places",
    noneChosen: "No place chosen yet. Add one below, or choose another option.",
    remove: "Remove",
    removeLabel: "Remove {place}",
    addSaved: "Add a saved place",
    addSavedNone: "No other saved places",
    add: "Add",
    coordinates: "Or enter coordinates",
    name: "Place name",
    latitude: "Latitude",
    longitude: "Longitude",
    addCoordinates: "Add these coordinates",
    nameRequired: "Enter a name for this place.",
    coordinateFormat: "Enter latitude and longitude as decimal numbers, for example 12.3456 and -45.6789.",
    coordinateRange: "Latitude must be between -90 and 90 and longitude between -180 and 180.",
    alreadyChosen: "That place is already chosen.",
    cancel: "Cancel",
    save: "Save for everyone",
    saving: "Saving…",
    saved: "Forecast places saved.",
    emptyManual: "Choose at least one place, or pick another option.",
    conflict: "This trip changed while you were editing. The latest version is shown; review it and save again.",
    staleNotice: "This trip has changed since you opened this form. Saving will ask you to review the latest version.",
    forbidden: "You can no longer change this trip.",
    invalid: "These places could not be saved. Check the coordinates and try again.",
    offline: "Not saved. Check your connection and press Save again.",
    error: "Not saved. Please try again.",
    limit: "This trip already has the maximum number of forecast places.",
    offShort: "No forecast chosen for this day",
    autoBadge: "Automatic"
  },
  "zh-Hans": {
    change: "更改天气预报地点",
    title: "这一天的天气预报地点",
    legend: "这一天的天气预报从哪里获取？",
    modeAuto: "自动，根据这一天行程中已保存的位置",
    modeManual: "选择地点",
    modeOff: "这一天不显示天气预报",
    nowAuto: "当前：自动 · {count} 个区域",
    nowAutoNone: "当前：自动 · 尚无已保存位置的行程",
    nowManual: "当前：已选地点 · {count} 个",
    nowOff: "当前：这一天不显示天气预报",
    autoPreview: "根据已保存行程位置得到的区域",
    autoNone: "这一天还没有带坐标的行程，因此没有自动天气预报。",
    stops: "{count} 个行程",
    areaNear: "{place}附近区域",
    area: "区域 {number}",
    chosen: "已选地点",
    noneChosen: "尚未选择地点。请在下方添加，或选择其他选项。",
    remove: "移除",
    removeLabel: "移除{place}",
    addSaved: "添加已保存的地点",
    addSavedNone: "没有其他已保存的地点",
    add: "添加",
    coordinates: "或输入坐标",
    name: "地点名称",
    latitude: "纬度",
    longitude: "经度",
    addCoordinates: "添加这些坐标",
    nameRequired: "请输入这个地点的名称。",
    coordinateFormat: "请用小数输入纬度和经度，例如 12.3456 和 -45.6789。",
    coordinateRange: "纬度须在 -90 到 90 之间，经度须在 -180 到 180 之间。",
    alreadyChosen: "这个地点已经选择。",
    cancel: "取消",
    save: "为所有人保存",
    saving: "正在保存…",
    saved: "天气预报地点已保存。",
    emptyManual: "请至少选择一个地点，或选择其他选项。",
    conflict: "编辑期间行程已有更改。已显示最新版本，请检查后再次保存。",
    staleNotice: "打开此表单后行程已有更改。保存时会请你检查最新版本。",
    forbidden: "你已无法更改这个行程。",
    invalid: "无法保存这些地点。请检查坐标后重试。",
    offline: "未保存。请检查网络连接后再次点击保存。",
    error: "未保存。请重试。",
    limit: "这个行程的天气预报地点已达上限。",
    offShort: "这一天未选择天气预报",
    autoBadge: "自动"
  },
  "zh-Hant": {
    change: "變更天氣預報地點",
    title: "這一天的天氣預報地點",
    legend: "這一天的天氣預報從哪裡取得？",
    modeAuto: "自動，依這一天行程中已儲存的位置",
    modeManual: "選擇地點",
    modeOff: "這一天不顯示天氣預報",
    nowAuto: "目前：自動 · {count} 個區域",
    nowAutoNone: "目前：自動 · 尚無已儲存位置的行程",
    nowManual: "目前：已選地點 · {count} 個",
    nowOff: "目前：這一天不顯示天氣預報",
    autoPreview: "依已儲存行程位置得到的區域",
    autoNone: "這一天還沒有帶座標的行程，因此沒有自動天氣預報。",
    stops: "{count} 個行程",
    areaNear: "{place}附近區域",
    area: "區域 {number}",
    chosen: "已選地點",
    noneChosen: "尚未選擇地點。請在下方新增，或選擇其他選項。",
    remove: "移除",
    removeLabel: "移除{place}",
    addSaved: "新增已儲存的地點",
    addSavedNone: "沒有其他已儲存的地點",
    add: "新增",
    coordinates: "或輸入座標",
    name: "地點名稱",
    latitude: "緯度",
    longitude: "經度",
    addCoordinates: "新增這些座標",
    nameRequired: "請輸入這個地點的名稱。",
    coordinateFormat: "請以小數輸入緯度和經度，例如 12.3456 和 -45.6789。",
    coordinateRange: "緯度須介於 -90 與 90 之間，經度須介於 -180 與 180 之間。",
    alreadyChosen: "這個地點已經選擇。",
    cancel: "取消",
    save: "為所有人儲存",
    saving: "正在儲存…",
    saved: "天氣預報地點已儲存。",
    emptyManual: "請至少選擇一個地點，或選擇其他選項。",
    conflict: "編輯期間行程已有變更。已顯示最新版本，請檢查後再次儲存。",
    staleNotice: "開啟此表單後行程已有變更。儲存時會請你檢查最新版本。",
    forbidden: "你已無法變更這個行程。",
    invalid: "無法儲存這些地點。請檢查座標後重試。",
    offline: "未儲存。請檢查網路連線後再次按下儲存。",
    error: "未儲存。請重試。",
    limit: "這個行程的天氣預報地點已達上限。",
    offShort: "這一天未選擇天氣預報",
    autoBadge: "自動"
  },
  ja: {
    change: "天気予報の地点を変更",
    title: "この日の天気予報の地点",
    legend: "この日の天気予報をどこから表示しますか？",
    modeAuto: "自動（この日の予定に保存された位置から）",
    modeManual: "地点を選ぶ",
    modeOff: "この日は天気予報を表示しない",
    nowAuto: "現在：自動 · {count} エリア",
    nowAutoNone: "現在：自動 · 位置が保存された予定はまだありません",
    nowManual: "現在：選んだ地点 · {count}",
    nowOff: "現在：この日は天気予報を表示しない",
    autoPreview: "保存済みの予定の位置から見つかったエリア",
    autoNone: "この日の予定には座標が保存されていないため、自動の天気予報はありません。",
    stops: "予定 {count} 件",
    areaNear: "{place}周辺エリア",
    area: "エリア {number}",
    chosen: "選んだ地点",
    noneChosen: "地点がまだ選ばれていません。下で追加するか、別の選択肢を選んでください。",
    remove: "削除",
    removeLabel: "{place}を削除",
    addSaved: "保存済みの地点を追加",
    addSavedNone: "ほかに保存済みの地点はありません",
    add: "追加",
    coordinates: "または座標を入力",
    name: "地点名",
    latitude: "緯度",
    longitude: "経度",
    addCoordinates: "この座標を追加",
    nameRequired: "この地点の名前を入力してください。",
    coordinateFormat: "緯度と経度を小数で入力してください（例：12.3456 と -45.6789）。",
    coordinateRange: "緯度は -90〜90、経度は -180〜180 の範囲で入力してください。",
    alreadyChosen: "その地点はすでに選ばれています。",
    cancel: "キャンセル",
    save: "全員のために保存",
    saving: "保存中…",
    saved: "天気予報の地点を保存しました。",
    emptyManual: "地点を1つ以上選ぶか、別の選択肢を選んでください。",
    conflict: "編集中に旅行が変更されました。最新の内容を表示しています。確認してからもう一度保存してください。",
    staleNotice: "このフォームを開いた後に旅行が変更されました。保存時に最新の内容の確認をお願いします。",
    forbidden: "この旅行は変更できなくなりました。",
    invalid: "これらの地点を保存できませんでした。座標を確認してもう一度お試しください。",
    offline: "保存されていません。接続を確認してもう一度保存を押してください。",
    error: "保存されていません。もう一度お試しください。",
    limit: "この旅行の天気予報の地点は上限に達しています。",
    offShort: "この日は天気予報が選ばれていません",
    autoBadge: "自動"
  }
});

export function weatherEditorText(language, key, variables = {}) {
  const table = TEXT[language] || TEXT.en;
  const template = table[key] ?? TEXT.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(variables[name] ?? ""));
}

let editorCount = 0;

/**
 * options:
 *   language, current: { mode, entries } (resolved association, entries carry label)
 *   autoAreas: [{ key, label, memberCount }]    current automatic groups (identified for review)
 *   savedPoints: [{ key, lat, lng, label, locationId?, name?, i18n? }] choosable saved points
 *   chosen: [{ key, label, locationId }]        current manual picks
 *   newLocationId(): string                      stable ID for a new location pick
 *   onSave(choice) -> Promise<status>, onCancel()
 */
export function createDayWeatherEditor(doc, options) {
  const id = `weather-editor-${++editorCount}`;
  const state = {
    language: options.language || "en",
    mode: options.current?.mode || "auto",
    picks: (options.chosen || []).map((pick) => ({ ...pick })),
    autoAreas: options.autoAreas || [],
    savedPoints: options.savedPoints || [],
    name: "", lat: "", lng: "", selected: "",
    busy: false, locked: false, message: "", messageKind: "", inlineError: "", stale: false
  };
  if (state.mode === "auto" && !state.picks.length) state.picks = [];
  const root = doc.createElement("section");
  root.className = "weather-editor";
  root.id = id;
  root.setAttribute("aria-labelledby", `${id}-title`);
  const t = (key, variables) => weatherEditorText(state.language, key, variables);
  const make = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (label, className, onClick, focusKey) => {
    const node = make("button", className, label);
    node.type = "button";
    if (focusKey) node.dataset.focusKey = focusKey;
    node.addEventListener("click", onClick);
    return node;
  };

  function prefillManual() {
    if (state.picks.length) return;
    // Switching from automatic: start from the automatic groups so one can be replaced or removed.
    state.picks = state.autoAreas
      .map((area) => state.savedPoints.find((point) => point.key === area.key))
      .filter(Boolean)
      .map((point) => toPick(point));
  }

  function toPick(point) {
    if (point.locationId) return { key: point.key, label: point.label, locationId: point.locationId };
    return {
      key: point.key, label: point.label, lat: point.lat, lng: point.lng,
      name: point.name || point.label, i18n: point.i18n, newLocationId: options.newLocationId()
    };
  }

  function choice() {
    if (state.mode !== "manual") return { mode: state.mode };
    return {
      mode: "manual",
      picks: state.picks.map((pick) => pick.locationId
        ? { locationId: pick.locationId }
        : { newLocationId: pick.newLocationId, name: pick.name, lat: pick.lat, lng: pick.lng, ...(pick.i18n ? { i18n: pick.i18n } : {}) })
    };
  }

  function render() {
    const focused = doc.activeElement && root.contains(doc.activeElement) ? doc.activeElement.dataset.focusKey : "";
    root.replaceChildren();
    const title = make("h3", "weather-editor__title", t("title"));
    title.id = `${id}-title`;
    root.append(title);
    const current = options.current || { mode: "auto", entries: [] };
    const currentCount = current.entries?.length || 0;
    root.append(make("p", "weather-editor__current", current.mode === "off" ? t("nowOff")
      : current.mode === "manual" ? t("nowManual", { count: currentCount })
        : currentCount ? t("nowAuto", { count: currentCount }) : t("nowAutoNone")));
    if (state.stale) root.append(make("p", "weather-editor__notice", t("staleNotice")));

    const fieldset = make("fieldset", "weather-editor__modes");
    fieldset.append(make("legend", "", t("legend")));
    for (const mode of ["auto", "manual", "off"]) {
      const label = make("label", "weather-editor__mode");
      const input = doc.createElement("input");
      input.type = "radio";
      input.name = `${id}-mode`;
      input.value = mode;
      input.checked = state.mode === mode;
      input.disabled = state.busy || state.locked;
      input.dataset.focusKey = `mode-${mode}`;
      input.addEventListener("change", () => {
        if (!input.checked) return;
        state.mode = mode;
        state.message = ""; state.inlineError = "";
        if (mode === "manual") prefillManual();
        render();
      });
      label.append(input, make("span", "", t(mode === "auto" ? "modeAuto" : mode === "manual" ? "modeManual" : "modeOff")));
      fieldset.append(label);
    }
    root.append(fieldset);

    if (state.mode === "auto") {
      const section = make("div", "weather-editor__auto");
      section.append(make("h4", "", t("autoPreview")));
      if (!state.autoAreas.length) section.append(make("p", "weather-editor__empty", t("autoNone")));
      else {
        const list = make("ul", "weather-editor__list");
        state.autoAreas.forEach((area) => {
          const item = make("li", "weather-editor__item");
          item.append(make("span", "weather-editor__badge", t("autoBadge")), make("span", "weather-editor__label", area.label),
            make("span", "weather-editor__meta", t("stops", { count: area.memberCount || 1 })));
          list.append(item);
        });
        section.append(list);
      }
      root.append(section);
    }

    if (state.mode === "manual") {
      const section = make("div", "weather-editor__manual");
      section.append(make("h4", "", t("chosen")));
      if (!state.picks.length) section.append(make("p", "weather-editor__empty", t("noneChosen")));
      else {
        const list = make("ul", "weather-editor__list");
        state.picks.forEach((pick, index) => {
          const item = make("li", "weather-editor__item");
          const remove = button(t("remove"), "button button--quiet weather-editor__remove", () => {
            state.picks.splice(index, 1);
            state.inlineError = "";
            render();
            const next = root.querySelector(`[data-focus-key="remove-${Math.min(index, state.picks.length - 1)}"]`) || root.querySelector("[data-focus-key='add-select']") || root.querySelector("[data-focus-key='mode-manual']");
            next?.focus();
          }, `remove-${index}`);
          remove.setAttribute("aria-label", t("removeLabel", { place: pick.label }));
          remove.disabled = state.busy || state.locked;
          item.append(make("span", "weather-editor__label", pick.label), remove);
          list.append(item);
        });
        section.append(list);
      }

      const chosenKeys = new Set(state.picks.map((pick) => pick.key));
      const available = state.savedPoints.filter((point) => !chosenKeys.has(point.key));
      const addRow = make("div", "weather-editor__add");
      const selectLabel = make("label", "field weather-editor__field");
      selectLabel.append(make("span", "", t("addSaved")));
      const select = doc.createElement("select");
      select.dataset.focusKey = "add-select";
      select.disabled = state.busy || state.locked || !available.length;
      if (!available.length) select.append(new doc.defaultView.Option(t("addSavedNone"), ""));
      available.forEach((point) => select.append(new doc.defaultView.Option(point.label, point.key)));
      if (available.some((point) => point.key === state.selected)) select.value = state.selected;
      select.addEventListener("change", () => { state.selected = select.value; });
      selectLabel.append(select);
      const add = button(t("add"), "button button--quiet", () => {
        const point = available.find((candidate) => candidate.key === (select.value || state.selected));
        if (!point) return;
        state.picks.push(toPick(point));
        state.selected = "";
        state.inlineError = "";
        render();
        root.querySelector("[data-focus-key='add-select']")?.focus();
      }, "add-saved");
      add.disabled = select.disabled;
      addRow.append(selectLabel, add);
      section.append(addRow);

      const coords = make("fieldset", "weather-editor__coordinates");
      coords.append(make("legend", "", t("coordinates")));
      const errorId = `${id}-coordinate-error`;
      const input = (key, labelKey, mode) => {
        const label = make("label", "field weather-editor__field");
        label.append(make("span", "", t(labelKey)));
        const node = doc.createElement("input");
        node.type = "text";
        node.inputMode = mode;
        node.autocomplete = "off";
        node.value = state[key];
        node.maxLength = key === "name" ? 200 : 20;
        node.dataset.focusKey = `coord-${key}`;
        node.disabled = state.busy || state.locked;
        if (state.inlineError) { node.setAttribute("aria-invalid", "true"); node.setAttribute("aria-describedby", errorId); }
        node.addEventListener("input", () => { state[key] = node.value; });
        label.append(node);
        return label;
      };
      const grid = make("div", "weather-editor__coordinate-grid");
      grid.append(input("name", "name", "text"), input("lat", "latitude", "decimal"), input("lng", "longitude", "decimal"));
      coords.append(grid);
      const inline = make("p", "weather-editor__error", state.inlineError);
      inline.id = errorId;
      inline.hidden = !state.inlineError;
      coords.append(inline);
      const addCoordinates = button(t("addCoordinates"), "button button--quiet", () => {
        const name = state.name.trim();
        const parsed = parseCoordinateEntry(state.lat, state.lng);
        state.inlineError = !name ? t("nameRequired")
          : !parsed.ok ? t(parsed.reason === "range" ? "coordinateRange" : "coordinateFormat")
            : chosenKeys.has(pointKey(parsed.lat, parsed.lng)) ? t("alreadyChosen") : "";
        if (!state.inlineError) {
          const key = pointKey(parsed.lat, parsed.lng);
          const saved = state.savedPoints.find((point) => point.key === key && point.locationId);
          state.picks.push(saved ? toPick(saved) : { key, label: name, name, lat: parsed.lat, lng: parsed.lng, newLocationId: options.newLocationId() });
          state.name = ""; state.lat = ""; state.lng = "";
        }
        render();
        root.querySelector(state.inlineError ? "[data-focus-key='coord-name']" : "[data-focus-key='add-coordinates']")?.focus();
      }, "add-coordinates");
      addCoordinates.disabled = state.busy || state.locked;
      coords.append(addCoordinates);
      section.append(coords);
      root.append(section);
    }

    const status = make("p", `weather-editor__status${state.messageKind ? ` weather-editor__status--${state.messageKind}` : ""}`, state.message);
    status.setAttribute("role", state.messageKind === "error" ? "alert" : "status");
    root.append(status);
    const actions = make("div", "weather-editor__actions");
    const cancel = button(t("cancel"), "button button--quiet", () => options.onCancel?.(), "cancel");
    cancel.disabled = state.busy;
    const save = button(state.busy ? t("saving") : t("save"), "button", submit, "save");
    save.disabled = state.busy || state.locked;
    actions.append(cancel, save);
    root.append(actions);
    if (focused) root.querySelector(`[data-focus-key="${focused}"]`)?.focus();
  }

  async function submit() {
    if (state.busy || state.locked) return;
    if (state.mode === "manual" && !state.picks.length) {
      state.message = t("emptyManual"); state.messageKind = "error"; render();
      return;
    }
    state.busy = true; state.message = ""; state.messageKind = "";
    render();
    let result = "error";
    try {
      result = await options.onSave(choice());
    } catch {
      result = "error";
    }
    state.busy = false;
    if (result === "saved") { state.message = t("saved"); state.messageKind = "ok"; state.stale = false; }
    else if (result === "forbidden") { state.locked = true; state.message = t("forbidden"); state.messageKind = "error"; }
    else { state.message = t(["conflict", "invalid", "offline", "limit"].includes(result) ? result : "error"); state.messageKind = "error"; }
    if (!api.disposed) render();
    return result;
  }

  const api = {
    element: root,
    disposed: false,
    get state() { return state; },
    setLanguage(language) { if (state.language !== language) { state.language = language; render(); } },
    /** The focused control's key, so a caller that re-attaches the element can restore focus. */
    focusedKey() { const active = doc.activeElement; return active && root.contains(active) ? active.dataset.focusKey || "" : ""; },
    restoreFocus(key) { if (key) root.querySelector(`[data-focus-key="${key}"]`)?.focus({ preventScroll: true }); },
    markStale(stale = true) { if (state.stale !== stale) { state.stale = stale; render(); } },
    /** Replace the shown data (after a conflict or a newer saved version) keeping the status message. */
    reset(next) {
      options.current = next.current;
      state.autoAreas = next.autoAreas || [];
      state.savedPoints = next.savedPoints || [];
      state.mode = next.current?.mode || "auto";
      state.picks = (next.chosen || []).map((pick) => ({ ...pick }));
      state.stale = false; state.locked = false; state.inlineError = "";
      render();
    },
    lock(message) { state.locked = true; state.message = t(message || "forbidden"); state.messageKind = "error"; render(); },
    submit,
    focus() { root.querySelector("input[type=radio]:checked")?.focus(); },
    dispose() { api.disposed = true; root.remove(); }
  };
  render();
  return api;
}
