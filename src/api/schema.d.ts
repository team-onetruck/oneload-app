/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 백엔드 OpenAPI 문서에서 생성한 API 타입. 직접 고치지 말고 `pnpm gen:api`로 다시 만든다.
 */

export interface paths {
    "/api/v1/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 상태 점검
         * @description API와 DB 연결 상태입니다. 비밀값이나 내부 경로는 담지 않습니다.
         */
        get: operations["health_api_v1_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 세션 생성
         * @description 앱을 열 때 한 번 호출합니다. 응답의 `session_token`을 이후 모든 세션 API에 Bearer 토큰으로 보냅니다. 2시간 동안 요청이 없으면 만료됩니다.
         */
        post: operations["create_session_api_v1_sessions_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sessions/{session_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * 언어·이동 선호 변경
         * @description 언어와 계단 회피 같은 선호만 바꿉니다. 목적지는 바꿀 수 없고 `/messages`로만 지정합니다.
         */
        patch: operations["update_session_api_v1_sessions__session_id__patch"];
        trace?: never;
    };
    "/api/v1/sessions/{session_id}/navigation-state": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 현재 진행 상태 조회
         * @description 앱 재시작이나 `REVISION_CONFLICT` 뒤에 상태를 다시 맞출 때 씁니다. `next_action`이 다음에 할 일을 알려줍니다.
         */
        get: operations["navigation_state_api_v1_sessions__session_id__navigation_state_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sessions/{session_id}/navigation-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 길안내 이벤트 보고
         * @description `navigation_started`(안내 시작 → navigating), `arrived`(도착 → arrived, 도착 지점이 새 현재 위치), `navigation_cancelled`(취소 → idle)을 묶어서 보냅니다. 오프라인 동안 쌓인 이벤트를 한 번에 보내도 되고, 같은 `event_id`는 한 번만 반영됩니다.
         */
        post: operations["report_navigation_events_api_v1_sessions__session_id__navigation_events_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sessions/{session_id}/feedback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 피드백 보내기
         * @description 안내 만족도(1~5)와 오류 신고를 기록합니다. QA·평가(R6)에 쓰입니다.
         */
        post: operations["send_feedback_api_v1_sessions__session_id__feedback_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/maps": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 지도 목록
         * @description 사용할 수 있는 지도와 버전, 층 목록입니다.
         */
        get: operations["list_maps_api_v1_maps_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/maps/{map_id}/graph": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 지도 그래프 내려받기
         * @description 노드·통로(`edges`)·표지판(`landmarks`)·거리뷰 사진(`panoramas`)을 한 번에 받습니다. 좌표·방향 규약은 `coordinate_system`을 따릅니다.
         */
        get: operations["get_graph_api_v1_maps__map_id__graph_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/maps/{map_id}/pois": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 목적지(POI) 검색
         * @description 수동 목적지 선택 화면용 검색입니다. 확인된(`verified`) 장소만 돌려주며, 이름(국/영)과 별칭에서 찾습니다.
         */
        get: operations["search_pois_api_v1_maps__map_id__pois_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sessions/{session_id}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 메시지 보내기 (핵심 진입점)
         * @description 질문, 목적지 선택, "길을 잃었어요"가 모두 여기로 옵니다. 텍스트는 JSON으로, 사진을 붙일 때(예: 발매기 사진 + "뭘 눌러요?")는 multipart로 보냅니다. 버튼으로 목적지를 고르면 `selected_poi_id`를 함께 보냅니다.
         *
         *     응답의 `status`가 세션 상태를 바꿉니다: `needs_clarification`(추가 질문), `destination_set`(목적지 확정 → 위치가 없으면 needs_location), `relocalize`(위치 다시 확인). `unverified_notes`는 화면에 "확인되지 않음"으로 구분해 보여줘야 합니다.
         */
        post: operations["send_message_api_v1_sessions__session_id__messages_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sessions/{session_id}/localizations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 사진으로 위치 후보 찾기
         * @description 안내판 사진에서 읽은 문구를 등록된 표지판과 비교해 위치 후보와 판단 근거(`evidence`)를 돌려줍니다. 위치를 자동으로 확정하지 않으며, 사용자가 `/location-confirmations`로 골라야 합니다. 후보가 없으면 `no_match`와 재촬영 안내(`retake_hint`)를 줍니다. 결과는 5분 뒤 만료됩니다.
         */
        post: operations["localize_api_v1_sessions__session_id__localizations_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sessions/{session_id}/location-confirmations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 현재 위치 확정
         * @description 사용자가 사진 후보 중 하나를 고르거나(`photo_candidate`, `localization_id` 필요) 목록에서 직접 고르면(`manual`) 그때 위치가 정해집니다. 성공하면 ready_to_navigate가 되고 `/routes`를 부를 수 있습니다.
         */
        post: operations["confirm_location_api_v1_sessions__session_id__location_confirmations_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sessions/{session_id}/routes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 경로 계산
         * @description 확정된 현재 위치에서 세션 목적지까지, 등록된 통로만으로 단계별 경로를 만듭니다. 각 단계에는 거리뷰 사진(`pano_id`)과 그 사진 위 화살표 방향(`arrow_yaw_deg`)이 붙습니다. 목적지는 `/messages`에서 정해진 것과 같아야 하고, 길을 잃은 뒤 다시 계산할 때는 `reroute: true`를 보냅니다.
         */
        post: operations["create_route_api_v1_sessions__session_id__routes_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** Body_localize_api_v1_sessions__session_id__localizations_post */
        Body_localize_api_v1_sessions__session_id__localizations_post: {
            /**
             * Image
             * @description JPEG, 2MB 이하. 처리 후 바로 버리고 저장하지 않습니다.
             */
            image: string;
            /**
             * Map Version
             * @description 앱이 가진 지도 버전. 서버와 다르면 409 MAP_VERSION_MISMATCH
             */
            map_version: string;
            /**
             * Floor Hint
             * @description 사용자가 짐작한 층, 예: B1
             */
            floor_hint?: string | null;
            /**
             * Last Node Id
             * @description 마지막으로 확정했던 노드
             */
            last_node_id?: string | null;
        };
        /** Candidate */
        Candidate: {
            /** Node Id */
            node_id: string;
            /** Floor Id */
            floor_id: string;
            /** Rank Score */
            rank_score: number;
            /** Heading Deg */
            heading_deg?: number | null;
            /** Landmark Id */
            landmark_id: string;
            /** Evidence */
            evidence: string[];
        };
        /** ClientInfo */
        ClientInfo: {
            /** Platform */
            platform: string;
            /** App Version */
            app_version: string;
            /**
             * Ar Capable
             * @default false
             */
            ar_capable: boolean;
        };
        /** ConfirmationIn */
        ConfirmationIn: {
            /**
             * Expected Revision
             * @description 직전 응답의 session.revision. 다르면 409 REVISION_CONFLICT
             */
            expected_revision: number;
            /**
             * Method
             * @description photo_candidate: 사진 후보 중 선택 · manual: 목록에서 직접 선택
             * @enum {string}
             */
            method: "photo_candidate" | "manual";
            /**
             * Localization Id
             * @description photo_candidate일 때 `/localizations` 응답의 id
             */
            localization_id?: string | null;
            /**
             * Selected Node Id
             * @description 사용자가 고른 위치 노드, 예: line4-gates
             * @example line4-gates
             */
            selected_node_id: string;
            /**
             * Selected Heading Deg
             * @description 후보에 방향이 있으면 그 값
             */
            selected_heading_deg?: number | null;
        };
        /** ConfirmationOut */
        ConfirmationOut: {
            /**
             * Status
             * @default confirmed
             * @constant
             */
            status: "confirmed";
            location: components["schemas"]["ConfirmedLocation"];
            session: components["schemas"]["SessionStatus"];
        };
        /** ConfirmedLocation */
        ConfirmedLocation: {
            /** Map Id */
            map_id: string;
            /** Floor Id */
            floor_id: string;
            /** Node Id */
            node_id: string;
            /** Heading Deg */
            heading_deg: number | null;
            /** Method */
            method: string;
        };
        /** CreateSessionIn */
        CreateSessionIn: {
            /**
             * Language
             * @description 안내 언어
             * @example ko
             * @enum {string}
             */
            language: "en" | "ko";
            /**
             * Map Id
             * @description `GET /maps`의 지도 id
             * @example seoul-station
             */
            map_id: string;
            client: components["schemas"]["ClientInfo"];
        };
        /** CreateSessionOut */
        CreateSessionOut: {
            /** Session Id */
            session_id: string;
            /** Session Token */
            session_token: string;
            /** Expires In S */
            expires_in_s: number;
            /**
             * Language
             * @enum {string}
             */
            language: "en" | "ko";
            /** Map Id */
            map_id: string;
            /** Map Version */
            map_version: string;
            session: components["schemas"]["SessionStatus"];
        };
        /** Destination */
        Destination: {
            /** Poi Id */
            poi_id: string;
        };
        /** Edge */
        Edge: {
            /** From */
            from: string;
            /** To */
            to: string;
            /**
             * Type
             * @enum {string}
             */
            type: "corridor" | "escalator" | "stairs" | "elevator" | "gate";
            /** Distance M */
            distance_m: number;
            /** Heading Deg */
            heading_deg: number;
            instruction: components["schemas"]["Text"];
        };
        /** FeedbackIn */
        FeedbackIn: {
            /** Route Id */
            route_id?: string | null;
            /**
             * Rating
             * @description 만족도 1~5
             */
            rating: number;
            /**
             * Category
             * @description 예: wrong_direction, unclear_instruction, other
             */
            category: string;
            /**
             * Comment
             * @default
             */
            comment: string;
            /**
             * Allow Image Retention
             * @description QA용 사진 7일 보관 동의
             * @default false
             */
            allow_image_retention: boolean;
        };
        /** FeedbackOut */
        FeedbackOut: {
            /** Feedback Id */
            feedback_id: string;
            /**
             * Status
             * @default received
             * @constant
             */
            status: "received";
        };
        /** Floor */
        Floor: {
            /** Floor Id */
            floor_id: string;
            /** Elevation M */
            elevation_m: number;
        };
        /** GraphOut */
        GraphOut: {
            /** Map Id */
            map_id: string;
            /** Map Version */
            map_version: string;
            /** Coordinate System */
            coordinate_system: {
                [key: string]: string;
            };
            /** Floors */
            floors: components["schemas"]["Floor"][];
            /** Nodes */
            nodes: components["schemas"]["Node"][];
            /** Edges */
            edges: components["schemas"]["Edge"][];
            /** Landmarks */
            landmarks: components["schemas"]["Landmark"][];
            /** Panoramas */
            panoramas: components["schemas"]["Panorama"][];
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /** HealthOut */
        HealthOut: {
            /**
             * Status
             * @enum {string}
             */
            status: "ok" | "degraded";
            /** Api Version */
            api_version: string;
            /** Dependencies */
            dependencies: {
                [key: string]: string;
            };
        };
        /** Landmark */
        Landmark: {
            /** Landmark Id */
            landmark_id: string;
            /** Node Id */
            node_id: string;
            /** Sign Texts */
            sign_texts: string[];
        };
        /** LocalizationOut */
        LocalizationOut: {
            /** Localization Id */
            localization_id: string;
            /**
             * Status
             * @enum {string}
             */
            status: "needs_confirmation" | "no_match";
            /** Map Version */
            map_version: string;
            /** Expires In S */
            expires_in_s: number;
            /** Candidates */
            candidates: components["schemas"]["Candidate"][];
            /** Retake Hint */
            retake_hint: string | null;
            /**
             * Next Action
             * @enum {string}
             */
            next_action: "confirm_location" | "recapture";
            session: components["schemas"]["SessionStatus"];
        };
        /** MapSummary */
        MapSummary: {
            /** Map Id */
            map_id: string;
            name: components["schemas"]["Text"];
            /** Version */
            version: string;
            /** Floors */
            floors: components["schemas"]["Floor"][];
            /** Ar Supported */
            ar_supported: boolean;
        };
        /** MapsOut */
        MapsOut: {
            /** Maps */
            maps: components["schemas"]["MapSummary"][];
        };
        /** MessageOut */
        MessageOut: {
            /**
             * Status
             * @enum {string}
             */
            status: "answered" | "needs_clarification" | "destination_set" | "relocalize" | "cannot_answer" | "out_of_scope";
            /**
             * Intent
             * @enum {string}
             */
            intent: "navigate_to_poi" | "ticket_purchase_and_navigation" | "payment_question" | "usage_question" | "report_off_route" | "out_of_scope";
            /** Assistant Message */
            assistant_message: string;
            /**
             * Items
             * @default []
             */
            items: string[];
            /** Tip */
            tip?: string | null;
            /**
             * Unverified Notes
             * @default []
             */
            unverified_notes: string[];
            slots: components["schemas"]["Slots"];
            destination?: components["schemas"]["Destination"] | null;
            /**
             * Suggested Replies
             * @default []
             */
            suggested_replies: components["schemas"]["SuggestedReply"][];
            /**
             * Sources
             * @default []
             */
            sources: components["schemas"]["Source"][];
            /**
             * Next Action
             * @enum {string}
             */
            next_action: "reply" | "locate" | "confirm_location" | "navigate" | "recapture" | "none";
            /** Message Id */
            message_id: string;
            session: components["schemas"]["SessionStatus"];
        };
        /** NavigationEvent */
        NavigationEvent: {
            /**
             * Event Id
             * @description 클라이언트가 만든 고유 id. 같은 id를 다시 보내면 무시합니다
             */
            event_id: string;
            /**
             * Type
             * @description navigation_started · arrived · navigation_cancelled
             * @enum {string}
             */
            type: "navigation_started" | "arrived" | "navigation_cancelled";
            /**
             * Client Timestamp
             * Format: date-time
             */
            client_timestamp: string;
            /**
             * Context
             * @default {}
             */
            context: {
                [key: string]: unknown;
            };
        };
        /** NavigationEventsIn */
        NavigationEventsIn: {
            /**
             * Route Id
             * @description 현재 경로 id (`/routes` 응답의 route_id)
             */
            route_id?: string | null;
            /** Events */
            events: components["schemas"]["NavigationEvent"][];
        };
        /** NavigationEventsOut */
        NavigationEventsOut: {
            /** Accepted Event Ids */
            accepted_event_ids: string[];
            session: components["schemas"]["SessionStatus"];
        };
        /** NavigationStateOut */
        NavigationStateOut: {
            session: components["schemas"]["SessionStatus"];
            /** Destination Poi Id */
            destination_poi_id: string | null;
            /** Confirmed Node Id */
            confirmed_node_id: string | null;
            /** Active Route Id */
            active_route_id: string | null;
            /** Route Revision */
            route_revision: number | null;
            /** Map Version */
            map_version: string;
            /**
             * Next Action
             * @enum {string}
             */
            next_action: "reply" | "locate" | "confirm_location" | "navigate" | "continue_navigation" | "none";
        };
        /** Node */
        Node: {
            /** Id */
            id: string;
            /** Floor Id */
            floor_id: string;
            position: components["schemas"]["Position"];
            name: components["schemas"]["Text"];
        };
        /** Panorama */
        Panorama: {
            /** Pano Id */
            pano_id: string;
            /** Node Id */
            node_id: string;
            /** Image Url */
            image_url: string;
            /** North Yaw Deg */
            north_yaw_deg: number;
            /** Captured At */
            captured_at: string | null;
            /** Is Example */
            is_example: boolean;
        };
        /** PatchSessionIn */
        PatchSessionIn: {
            /**
             * Expected Revision
             * @description 직전 응답의 session.revision. 다르면 409 REVISION_CONFLICT
             */
            expected_revision: number;
            /** Language */
            language?: ("en" | "ko") | null;
            preferences?: components["schemas"]["Preferences"] | null;
        };
        /** PatchSessionOut */
        PatchSessionOut: {
            /** Session Id */
            session_id: string;
            /**
             * Language
             * @enum {string}
             */
            language: "en" | "ko";
            preferences: components["schemas"]["Preferences"];
            /** Requires Route Refresh */
            requires_route_refresh: boolean;
            session: components["schemas"]["SessionStatus"];
        };
        /** PoiOut */
        PoiOut: {
            /** Poi Id */
            poi_id: string;
            /** Name Ko */
            name_ko: string;
            /** Name En */
            name_en: string;
            /** Category */
            category: string;
            /** Train Type */
            train_type: ("express" | "allstop") | null;
            /** Floor Id */
            floor_id: string;
            /** Nearest Node Id */
            nearest_node_id: string;
            /** Aliases */
            aliases: string[];
            /** Verified */
            verified: boolean;
        };
        /** PoisOut */
        PoisOut: {
            /** Map Id */
            map_id: string;
            /** Map Version */
            map_version: string;
            /** Pois */
            pois: components["schemas"]["PoiOut"][];
        };
        /** Position */
        Position: {
            /** X */
            x: number;
            /** Y */
            y: number;
            /** Z */
            z: number;
        };
        /** Preferences */
        Preferences: {
            /**
             * Avoid Stairs
             * @description 계단이 없는 경로만 사용
             * @default false
             */
            avoid_stairs: boolean;
        };
        /** RouteIn */
        RouteIn: {
            /**
             * Expected Revision
             * @description 직전 응답의 session.revision. 다르면 409 REVISION_CONFLICT
             */
            expected_revision: number;
            /**
             * Destination Poi Id
             * @description `/messages`에서 정해진 목적지와 같아야 합니다
             */
            destination_poi_id: string;
            /**
             * Map Version
             * @description 앱이 가진 지도 버전
             */
            map_version: string;
            /**
             * @default {
             *       "type": "confirmed_node"
             *     }
             */
            start: components["schemas"]["RouteStart"];
            /** @description 비우면 세션에 저장된 선호를 씁니다 */
            preferences?: components["schemas"]["Preferences"] | null;
            /**
             * Reroute
             * @description 길을 잃은 뒤 같은 목적지로 다시 계산할 때 true
             * @default false
             */
            reroute: boolean;
        };
        /** RouteOut */
        RouteOut: {
            /** Route Id */
            route_id: string;
            /** Route Revision */
            route_revision: number;
            /**
             * Status
             * @default created
             * @constant
             */
            status: "created";
            /** Map Id */
            map_id: string;
            /** Map Version */
            map_version: string;
            /** Start Node Id */
            start_node_id: string;
            /** Destination Poi Id */
            destination_poi_id: string;
            /** Distance M */
            distance_m: number;
            /** Path Node Ids */
            path_node_ids: string[];
            /** Waypoints */
            waypoints: components["schemas"]["Waypoint"][];
            /** Steps */
            steps: components["schemas"]["RouteStepOut"][];
            session: components["schemas"]["SessionStatus"];
        };
        /** RouteStart */
        RouteStart: {
            /**
             * Type
             * @default confirmed_node
             * @constant
             */
            type: "confirmed_node";
        };
        /** RouteStepOut */
        RouteStepOut: {
            /** Step Id */
            step_id: string;
            /** Kind */
            kind: string;
            /** From Node Id */
            from_node_id: string;
            /** To Node Id */
            to_node_id: string;
            /** Distance M */
            distance_m: number;
            /** Instruction En */
            instruction_en: string;
            /** Instruction Ko */
            instruction_ko: string;
            /** Pano Id */
            pano_id: string | null;
            /** Arrow Yaw Deg */
            arrow_yaw_deg: number | null;
        };
        /** SessionStatus */
        SessionStatus: {
            /** State */
            state: string;
            /** Revision */
            revision: number;
        };
        /** Slots */
        Slots: {
            /**
             * Train Type
             * @default unknown
             * @enum {string}
             */
            train_type: "express" | "allstop" | "unknown";
            /**
             * Has Transit Card
             * @default unknown
             * @enum {string}
             */
            has_transit_card: "yes" | "no" | "unknown";
        };
        /** Source */
        Source: {
            /** Document Id */
            document_id: string;
            /** Title */
            title: string;
            /** Source Url */
            source_url?: string | null;
            /** Verified At */
            verified_at: string;
        };
        /** SuggestedReply */
        SuggestedReply: {
            /** Label */
            label: string;
            /** Selected Poi Id */
            selected_poi_id?: string | null;
        };
        /** Text */
        Text: {
            /** En */
            en: string;
            /** Ko */
            ko: string;
        };
        /** ValidationError */
        ValidationError: {
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
            /** Input */
            input?: unknown;
            /** Context */
            ctx?: Record<string, never>;
        };
        /** Waypoint */
        Waypoint: {
            /** Waypoint Id */
            waypoint_id: string;
            /** Floor Id */
            floor_id: string;
            position_map_m: components["schemas"]["Position"];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    health_api_v1_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 성공 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthOut"];
                };
            };
        };
    };
    create_session_api_v1_sessions_post: {
        parameters: {
            query?: never;
            header: {
                /** @description 요청마다 새 UUID. 같은 키와 같은 본문으로 다시 보내면 저장된 응답을 돌려줍니다. */
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateSessionIn"];
            };
        };
        responses: {
            /** @description 성공 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateSessionOut"];
                };
            };
            /** @description 입력 형식 오류 (code: INVALID_INPUT) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_session_api_v1_sessions__session_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PatchSessionIn"];
            };
        };
        responses: {
            /** @description 성공 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PatchSessionOut"];
                };
            };
            /** @description 입력 형식 오류 (code: INVALID_INPUT) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    navigation_state_api_v1_sessions__session_id__navigation_state_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 성공 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NavigationStateOut"];
                };
            };
            /** @description 입력 형식 오류 (code: INVALID_INPUT) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    report_navigation_events_api_v1_sessions__session_id__navigation_events_post: {
        parameters: {
            query?: never;
            header: {
                /** @description 요청마다 새 UUID. 같은 키와 같은 본문으로 다시 보내면 저장된 응답을 돌려줍니다. */
                "Idempotency-Key": string;
            };
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NavigationEventsIn"];
            };
        };
        responses: {
            /** @description 성공 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NavigationEventsOut"];
                };
            };
            /** @description 입력 형식 오류 (code: INVALID_INPUT) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    send_feedback_api_v1_sessions__session_id__feedback_post: {
        parameters: {
            query?: never;
            header: {
                /** @description 요청마다 새 UUID. 같은 키와 같은 본문으로 다시 보내면 저장된 응답을 돌려줍니다. */
                "Idempotency-Key": string;
            };
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FeedbackIn"];
            };
        };
        responses: {
            /** @description 성공 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FeedbackOut"];
                };
            };
            /** @description 입력 형식 오류 (code: INVALID_INPUT) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_maps_api_v1_maps_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 성공 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MapsOut"];
                };
            };
        };
    };
    get_graph_api_v1_maps__map_id__graph_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                map_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 성공 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GraphOut"];
                };
            };
            /** @description 입력 형식 오류 (code: INVALID_INPUT) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    search_pois_api_v1_maps__map_id__pois_get: {
        parameters: {
            query?: {
                /** @description 검색어, 예: 직통, express. 비우면 전체 */
                query?: string;
            };
            header?: never;
            path: {
                map_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 성공 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PoisOut"];
                };
            };
            /** @description 입력 형식 오류 (code: INVALID_INPUT) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    send_message_api_v1_sessions__session_id__messages_post: {
        parameters: {
            query?: never;
            header: {
                /** @description 요청마다 새 UUID. 같은 키와 같은 본문으로 다시 보내면 저장된 응답을 돌려줍니다. */
                "Idempotency-Key": string;
            };
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * Message
                     * @description 사용자 문장
                     * @default
                     * @example 돈은 어떻게 내요?
                     */
                    message?: string;
                    /**
                     * Language
                     * @description 이번 메시지부터 바꿀 언어 (선택)
                     */
                    language?: ("en" | "ko") | null;
                    /**
                     * Selected Poi Id
                     * @description 목적지 버튼·목록에서 고른 POI id (선택)
                     */
                    selected_poi_id?: string | null;
                };
                "multipart/form-data": {
                    /**
                     * Message
                     * @description 사용자 문장
                     * @default
                     * @example 돈은 어떻게 내요?
                     */
                    message?: string;
                    /**
                     * Language
                     * @description 이번 메시지부터 바꿀 언어 (선택)
                     */
                    language?: ("en" | "ko") | null;
                    /**
                     * Selected Poi Id
                     * @description 목적지 버튼·목록에서 고른 POI id (선택)
                     */
                    selected_poi_id?: string | null;
                    /**
                     * Format: binary
                     * @description JPEG, 2MB 이하. 저장하지 않습니다.
                     */
                    image?: string;
                };
            };
        };
        responses: {
            /** @description 성공 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessageOut"];
                };
            };
            /** @description 입력 형식 오류 (code: INVALID_INPUT) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    localize_api_v1_sessions__session_id__localizations_post: {
        parameters: {
            query?: never;
            header: {
                /** @description 요청마다 새 UUID. 같은 키와 같은 본문으로 다시 보내면 저장된 응답을 돌려줍니다. */
                "Idempotency-Key": string;
            };
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_localize_api_v1_sessions__session_id__localizations_post"];
            };
        };
        responses: {
            /** @description 성공 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocalizationOut"];
                };
            };
            /** @description 입력 형식 오류 (code: INVALID_INPUT) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    confirm_location_api_v1_sessions__session_id__location_confirmations_post: {
        parameters: {
            query?: never;
            header: {
                /** @description 요청마다 새 UUID. 같은 키와 같은 본문으로 다시 보내면 저장된 응답을 돌려줍니다. */
                "Idempotency-Key": string;
            };
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConfirmationIn"];
            };
        };
        responses: {
            /** @description 성공 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConfirmationOut"];
                };
            };
            /** @description 입력 형식 오류 (code: INVALID_INPUT) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_route_api_v1_sessions__session_id__routes_post: {
        parameters: {
            query?: never;
            header: {
                /** @description 요청마다 새 UUID. 같은 키와 같은 본문으로 다시 보내면 저장된 응답을 돌려줍니다. */
                "Idempotency-Key": string;
            };
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RouteIn"];
            };
        };
        responses: {
            /** @description 성공 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RouteOut"];
                };
            };
            /** @description 입력 형식 오류 (code: INVALID_INPUT) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
}
