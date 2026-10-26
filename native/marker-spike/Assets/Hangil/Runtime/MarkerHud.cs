using System;
using Hangil.MarkerCore;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem.UI;
using UnityEngine.UI;

namespace Hangil.MarkerSpike
{
    // Retained, touch-first UI. Tracking and safety checks run separately, every frame.
    public sealed class MarkerHud : MonoBehaviour
    {
        public event Action AlignRequested;
        public event Action ResetRequested;
        public event Action MeasurementsChanged;
        public bool Korean { get; private set; }
        public bool Confirmed { get { return confirmation.isOn; } }
        public string Height { get { return height.text; } }
        public string Distance { get { return distance.text; } }

        RectTransform safe, panel;
        Rect lastSafe;
        int lastWidth, lastHeight;
        Font font;
        GameObject canvasObject;
        Text title, badge, stage, hint, notice, counter, heightLabel, distanceLabel, confirmLabel, primaryLabel, resetLabel, languageLabel;
        InputField height, distance;
        Toggle confirmation;
        Button primary, reset;
        GameObject fields;
        ScrollRect scroll;
        GuideState lastState = (GuideState)(-1);
        string lastNotice;
        int lastSecond = -1;
        bool dirty = true;
        static readonly Color Ink = new Color(0.08f, 0.12f, 0.19f);
        static readonly Color Accent = new Color(0.04f, 0.39f, 0.32f);

        void Awake()
        {
            Korean = Application.systemLanguage == SystemLanguage.Korean;
            font = Resources.Load<Font>("HangilUi");
            if (font == null) throw new InvalidOperationException("HangilUi font is required for Korean guidance.");
            var canvas = new GameObject("Marker HUD", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasObject = canvas;
            canvas.transform.SetParent(transform, false);
            canvas.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = canvas.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(540, 960);
            scaler.matchWidthOrHeight = 0.5f;
            safe = Rect("Safe area", canvas.transform);
            Stretch(safe);

            var header = Rect("Header", safe);
            header.anchorMin = new Vector2(0, 1); header.anchorMax = Vector2.one;
            header.pivot = new Vector2(0.5f, 1); header.offsetMin = new Vector2(16, -116); header.offsetMax = new Vector2(-16, -12);
            Background(header, new Color(1, 1, 1, 0.96f));
            title = Label(header, 24, Ink); Place(title.rectTransform, 16, 10, -132, 40);
            badge = Label(header, 17, Ink); Place(badge.rectTransform, 16, 57, -16, 32);
            var language = Button(header, out languageLabel, new Color(0.9f, 0.94f, 0.93f));
            var langRect = (RectTransform)language.transform;
            langRect.anchorMin = langRect.anchorMax = Vector2.one; langRect.pivot = Vector2.one;
            langRect.anchoredPosition = new Vector2(-12, -10); langRect.sizeDelta = new Vector2(112, 48);
            languageLabel.color = Ink;
            language.onClick.AddListener(() => { Korean = !Korean; dirty = true; });

            // Bottom panel scrolls on compact screens; the camera remains visible above it.
            panel = Rect("Guidance card", safe);
            panel.anchorMin = Vector2.zero; panel.anchorMax = new Vector2(1, 0.62f);
            panel.offsetMin = new Vector2(16, 12); panel.offsetMax = new Vector2(-16, 0);
            Background(panel, new Color(1, 1, 1, 0.97f));
            var viewport = Rect("Viewport", panel); Stretch(viewport);
            viewport.offsetMin = new Vector2(16, 142); viewport.offsetMax = new Vector2(-16, -12);
            viewport.gameObject.AddComponent<RectMask2D>();
            Background(viewport, Color.clear).raycastTarget = true;
            var content = Rect("Content", viewport);
            content.anchorMin = new Vector2(0, 1); content.anchorMax = Vector2.one; content.pivot = new Vector2(0.5f, 1);
            content.offsetMin = content.offsetMax = Vector2.zero;
            var layout = content.gameObject.AddComponent<VerticalLayoutGroup>();
            layout.spacing = 8; layout.childControlHeight = true; layout.childForceExpandHeight = false;
            var fitter = content.gameObject.AddComponent<ContentSizeFitter>(); fitter.verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll = panel.gameObject.AddComponent<ScrollRect>();
            scroll.viewport = viewport; scroll.content = content; scroll.horizontal = false;
            scroll.movementType = ScrollRect.MovementType.Clamped;
            stage = RowLabel(content, 17, Accent, 28);
            hint = RowLabel(content, 23, Ink, 120);
            notice = RowLabel(content, 18, new Color(0.55f, 0.22f, 0.05f), 96);
            fields = Rect("Measurements", content).gameObject;
            var fieldLayout = fields.AddComponent<VerticalLayoutGroup>();
            fieldLayout.spacing = 6; fieldLayout.childControlHeight = true; fieldLayout.childForceExpandHeight = false;
            heightLabel = RowLabel(fields.transform, 18, Ink, 28);
            height = Input(fields.transform, "");
            distanceLabel = RowLabel(fields.transform, 18, Ink, 28);
            distance = Input(fields.transform, "1.00");
            height.onValueChanged.AddListener(_ => EditMeasurements());
            distance.onValueChanged.AddListener(_ => EditMeasurements());
            var toggleRect = Rect("Measured confirmation", fields.transform); Size(toggleRect, 72);
            confirmation = toggleRect.gameObject.AddComponent<Toggle>();
            var box = Rect("Box", toggleRect); box.anchorMin = box.anchorMax = new Vector2(0, 0.5f);
            box.pivot = new Vector2(0, 0.5f); box.anchoredPosition = Vector2.zero; box.sizeDelta = new Vector2(32, 32);
            confirmation.targetGraphic = Background(box, new Color(0.8f, 0.85f, 0.84f));
            var tick = Rect("Check", box); Stretch(tick); tick.offsetMin = Vector2.one * 6; tick.offsetMax = Vector2.one * -6;
            confirmation.graphic = Background(tick, Accent);
            confirmLabel = Label(toggleRect, 18, Ink); Stretch(confirmLabel.rectTransform);
            confirmLabel.rectTransform.offsetMin = new Vector2(44, 0);
            // Entire row is a touch target, including its text.
            Background(toggleRect, Color.clear).raycastTarget = true;
            confirmation.onValueChanged.AddListener(_ => { dirty = true; if (MeasurementsChanged != null) MeasurementsChanged(); });
            counter = RowLabel(content, 19, Accent, 36);
            var footer = Rect("Actions", panel);
            footer.anchorMin = Vector2.zero; footer.anchorMax = new Vector2(1, 0); footer.pivot = new Vector2(0.5f, 0);
            footer.offsetMin = new Vector2(16, 12); footer.offsetMax = new Vector2(-16, 130);
            var footerLayout = footer.gameObject.AddComponent<VerticalLayoutGroup>();
            footerLayout.spacing = 8; footerLayout.childControlHeight = true; footerLayout.childForceExpandHeight = false;
            primary = Button(footer, out primaryLabel, Accent); Size((RectTransform)primary.transform, 58);
            primary.onClick.AddListener(() => { if (AlignRequested != null) AlignRequested(); });
            reset = Button(footer, out resetLabel, new Color(0.9f, 0.94f, 0.93f)); Size((RectTransform)reset.transform, 52);
            resetLabel.color = Ink;
            reset.onClick.AddListener(() => { if (ResetRequested != null) ResetRequested(); });
            if (EventSystem.current == null)
            {
                var events = new GameObject("UI events", typeof(EventSystem), typeof(InputSystemUIInputModule));
                events.transform.SetParent(transform, false);
            }
            RefreshSafeArea();
        }

        void EditMeasurements()
        {
            // A changed value must be measured again; never silently retain the previous confirmation.
            confirmation.isOn = false;
            dirty = true;
            if (MeasurementsChanged != null) MeasurementsChanged();
        }

        public void SetVisible(bool visible) { if (canvasObject != null) canvasObject.SetActive(visible); }
        public void RecheckMeasurements() { confirmation.isOn = false; dirty = true; }

        public void Present(GuideState state, string koNotice, string enNotice, double secondsLeft)
        {
            RefreshSafeArea();
            string message = Korean ? koNotice : enNotice;
            int seconds = Math.Max(0, (int)Math.Ceiling(secondsLeft));
            if (!dirty && state == lastState && message == lastNotice && seconds == lastSecond) return;
            bool stateChanged = state != lastState;
            dirty = false; lastState = state; lastNotice = message; lastSecond = seconds;
            title.text = Korean ? "한길 · 화살표 맞추기" : "Hangil · Place an arrow";
            badge.text = Korean ? "측정용 · 실제 길안내 아님" : "Measurement only · Not navigation";
            languageLabel.text = Korean ? "English" : "한국어";
            bool active = state == GuideState.Active;
            bool setup = state == GuideState.Measurements || state == GuideState.Confirmation;
            panel.anchorMax = new Vector2(1, setup ? 0.72f : 0.52f);
            bool locked = active || state == GuideState.CreatingAnchor || state == GuideState.WaitingAnchor;
            stage.text = active ? (Korean ? "3 / 3  바닥 표시와 비교" : "3 / 3  Compare with the floor mark") :
                (state == GuideState.Measurements || state == GuideState.Confirmation ?
                (Korean ? "1 / 3  줄자로 측정하기" : "1 / 3  Measure your setup") :
                (Korean ? "2 / 3  벽 그림 찾기" : "2 / 3  Find the wall picture"));
            hint.text = ExperimentGuide.Hint(state, Korean);
            notice.text = message ?? ""; notice.gameObject.SetActive(!string.IsNullOrEmpty(message));
            fields.SetActive(setup);
            heightLabel.text = Korean ? "바닥 → 그림 중심 높이 (m)" : "Floor → picture centre height (m)";
            distanceLabel.text = Korean ? "벽 → 바닥 목표점 거리 (m)" : "Wall → floor target distance (m)";
            confirmLabel.text = Korean ? "그림 너비 18cm, 높이와 목표 거리를 직접 쟀어요" : "I measured the 18cm print width, height and target distance";
            primary.interactable = state == GuideState.Ready;
            primary.gameObject.SetActive(!active);
            primaryLabel.text = locked ? (Korean ? "위치를 맞추는 중…" : "Placing…") : (Korean ? "화살표 표시하기" : "Show test arrow");
            resetLabel.text = locked ? (Korean ? "숨기고 다시 맞추기" : "Hide and realign") : (Korean ? "측정값 다시 확인하기" : "Review measurements");
            counter.gameObject.SetActive(active);
            if (active) counter.text = Korean ? "다시 맞추기까지 " + seconds + "초 · 최대 3m" : seconds + "s remaining · maximum 3m";
            if (stateChanged) { scroll.StopMovement(); scroll.verticalNormalizedPosition = 1; }
        }

        void RefreshSafeArea()
        {
            Rect area = Screen.safeArea;
            if (area == lastSafe && lastWidth == Screen.width && lastHeight == Screen.height) return;
            lastSafe = area; lastWidth = Screen.width; lastHeight = Screen.height;
            if (Screen.width <= 0 || Screen.height <= 0) return;
            safe.anchorMin = new Vector2(area.xMin / Screen.width, area.yMin / Screen.height);
            safe.anchorMax = new Vector2(area.xMax / Screen.width, area.yMax / Screen.height);
        }

        static RectTransform Rect(string name, Transform parent)
        {
            var value = new GameObject(name, typeof(RectTransform)).GetComponent<RectTransform>();
            value.SetParent(parent, false); return value;
        }
        static void Stretch(RectTransform r) { r.anchorMin = Vector2.zero; r.anchorMax = Vector2.one; r.offsetMin = r.offsetMax = Vector2.zero; }
        static void Place(RectTransform r, float left, float top, float right, float height)
        {
            r.anchorMin = new Vector2(0, 1); r.anchorMax = Vector2.one; r.pivot = new Vector2(0.5f, 1);
            r.offsetMin = new Vector2(left, -top - height); r.offsetMax = new Vector2(right, -top);
        }
        static Image Background(RectTransform r, Color color) { var image = r.gameObject.AddComponent<Image>(); image.color = color; image.raycastTarget = false; return image; }
        static void Size(RectTransform r, float height) { r.gameObject.AddComponent<LayoutElement>().preferredHeight = height; }
        Text Label(Transform parent, int size, Color color)
        {
            var text = Rect("Text", parent).gameObject.AddComponent<Text>(); text.font = font; text.fontSize = size;
            text.color = color; text.alignment = TextAnchor.MiddleLeft; text.raycastTarget = false;
            text.supportRichText = false; text.horizontalOverflow = HorizontalWrapMode.Wrap; return text;
        }
        Text RowLabel(Transform parent, int size, Color color, float height) { var text = Label(parent, size, color); Size(text.rectTransform, height); return text; }
        Button Button(Transform parent, out Text label, Color color)
        {
            var rect = Rect("Button", parent); var image = Background(rect, color); image.raycastTarget = true;
            var button = rect.gameObject.AddComponent<Button>(); button.targetGraphic = image;
            var colors = button.colors; colors.disabledColor = new Color(0.55f, 0.6f, 0.59f); button.colors = colors;
            label = Label(rect, 21, Color.white); label.alignment = TextAnchor.MiddleCenter;
            Stretch(label.rectTransform); label.rectTransform.offsetMin = new Vector2(8, 0); label.rectTransform.offsetMax = new Vector2(-8, 0);
            return button;
        }
        InputField Input(Transform parent, string initial)
        {
            var rect = Rect("Measurement", parent); Size(rect, 54);
            var image = Background(rect, new Color(0.93f, 0.95f, 0.95f)); image.raycastTarget = true;
            var field = rect.gameObject.AddComponent<InputField>(); field.targetGraphic = image;
            var value = Label(rect, 23, Ink); Stretch(value.rectTransform); value.rectTransform.offsetMin = new Vector2(14, 0); value.rectTransform.offsetMax = new Vector2(-14, 0);
            field.textComponent = value; field.keyboardType = TouchScreenKeyboardType.DecimalPad;
            field.characterLimit = 6; field.lineType = InputField.LineType.SingleLine; field.text = initial;
            return field;
        }
    }
}
