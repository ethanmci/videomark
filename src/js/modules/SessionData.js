// eslint-disable-next-line import/no-unresolved
import uuidv4 from "uuid/v4";
// eslint-disable-next-line import/no-unresolved
import msgpack from "msgpack-lite";

import Config from "./Config";
import VideoData from "./VideoData";
import { useStorage } from "./Storage";

export default class SessionData {
  constructor(id, version) {
    this.session_id = id;
    this.version = version;
    this.startTime = 0;
    this.endTime = 0;
    this.userAgent =
      window &&
      (window.sodium ? window.sodium.userAgent : window) &&
      (window.navigator ? window.navigator.userAgent : "");
    this.appVersion = this.userAgent.substr(this.userAgent.indexOf("/") + 1);
    this.sequence = 0;
    this.video = [];
    this.latest_qoe_update_count = 0;
  }

  get_session_id() {
    return this.session_id;
  }

  /**
   * 計測対象のvideo
   */
  get_main_video() {
    return this.video.find(e => e.is_main_video());
  }

  /**
   * videoの利用可否
   */
  get_video_availability() {
    const main_video = this.get_main_video();
    if (main_video === undefined) return false;
    return main_video.is_available();
  }

  /**
   * 各videoのクオリティ情報の更新
   */
  update_quality_info() {
    this.video.forEach(e => e.update());
  }

  /**
   * videoリストの更新
   * @param {HTMLCollection} elms
   */
  set_video_elms(elms) {
    Array.prototype.forEach.call(elms, elm => {
      if (!this.video.find(e => e.video_elm === elm)) {
        const video_id = uuidv4();
        try {
          const new_video = new VideoData(elm, video_id);
          /* eslint-disable no-console */
          console.log(`VIDEOMARK: new video found uuid[${video_id}]`);
          this.video.push(new_video);
        } catch (err) {
          // どのタイプでもない
        }
      }
    });
    const removing = this.video.filter(
      e =>
        !Array.prototype.find.call(elms, elm => elm === e.video_elm) ||
        !e.is_stay()
    );
    removing.forEach(e => {
      e.clear();
      this.video.splice(this.video.indexOf(e), 1);
    });
  }

  async start() {
    for (;;) {
      // --- main video --- //
      const main_video = this.get_main_video();
      if (!main_video) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve =>
          setTimeout(() => resolve(), Config.get_check_state_interval())
        );
        // eslint-disable-next-line no-continue
        continue;
      }

      console.log(
        `VIDEOMARK: STATE CHANGE found main video ${main_video.get_video_id()}`
      );

      // --- play start --- //
      let start_time = -1;
      for (; start_time === -1 && main_video === this.get_main_video(); ) {
        // eslint-disable-next-line no-await-in-loop
        await SessionData.event_wait(
          main_video.video_elm,
          "play",
          Config.get_check_state_interval()
        );
        start_time = main_video.get_start_time();
      }

      // eslint-disable-next-line no-continue
      if (main_video !== this.get_main_video()) continue;

      console.log(`VIDEOMARK: STATE CHANGE play ${new Date(start_time)}`);

      try {
        // eslint-disable-next-line no-await-in-loop
        await this._play_started(main_video);
      } catch (err) {
        console.log(`VIDEOMARK: ${err}`);
      }
    }
  }

  async _play_started(main_video) {
    const qoe_request_start =
      Config.get_trans_interval() * Config.get_send_data_count_for_qoe() -
      Config.get_prev_count_for_qoe();
    const qoe_request_timeout =
      qoe_request_start + Config.get_max_count_for_qoe();

    let i = 0;
    let qoe = null;

    // --- latest qoe --- //
    for (; !qoe && i < qoe_request_timeout; i += 1) {
      let data = false;
      let request = false;

      if (main_video.is_available()) {
        data = i % Config.get_trans_interval() === 0;
        request = i > qoe_request_start;
      }

      // eslint-disable-next-line no-await-in-loop
      qoe = await this._transaction(
        main_video,
        data,
        request,
        Config.get_check_state_interval()
      );

      if (main_video !== this.get_main_video()) return;
    }

    console.log(`VIDEOMARK: STATE CHANGE latest qoe computed ${qoe}`);

    // --- 通常処理 --- //
    for (; ; i += 1) {
      let data = false;
      let request = false;

      if (main_video.is_available()) {
        data = i % Config.get_trans_interval() === 0;
        request =
          i % (Config.get_trans_interval() * Config.get_latest_qoe_update()) ===
          0;
      }

      // eslint-disable-next-line no-await-in-loop
      qoe = await this._transaction(
        main_video,
        data,
        request,
        Config.get_check_state_interval()
      );

      if (main_video !== this.get_main_video()) return;
    }
  }

  async _transaction(main_video, data, request, wait) {
    let qoe = null;

    const tasks = [];

    if (main_video.is_available()) {
      if (data) {
        // --- send to fluent --- //
        this._send_data(main_video);
      }
      if (request) {
        // --- request qoe --- //
        // eslint-disable-next-line no-loop-func
        tasks.push(
          (async () => {
            qoe = await this._request_qoe(main_video);
            if (qoe)
              main_video.add_latest_qoe({
                date: Date.now(),
                qoe
              });
          })()
        );
      }
      // --- save to storage --- //
      this._store_session(main_video);
    }

    // --- set timeout --- //
    // eslint-disable-next-line no-loop-func
    tasks.push(new Promise(resolve => setTimeout(() => resolve(), wait)));

    // eslint-disable-next-line no-await-in-loop
    await Promise.all(tasks);

    return qoe;
  }

  async _send_data(video) {
    try {
      const ret = await fetch(Config.get_fluent_url(), {
        method: "POST",
        headers: {
          "Content-type": "application/msgpack"
        },
        body: msgpack.encode(this._to_json(video))
      });
      if (!ret.ok) {
        throw new Error("fluent response was not ok.");
      }
    } catch (err) {
      console.error(`VIDEOMARK: ${err}`);
    }
  }

  async _request_qoe(video) {
    try {
      const ret = await fetch(`${Config.get_sodium_server_url()}/latest_qoe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ids: {
            session_id: this.session_id,
            video_id: video.get_video_id()
          }
        })
      });
      if (!ret.ok) {
        throw new Error("SodiumServer response was not ok.");
      }
      const json = await ret.json();
      const qoe = Number.parseFloat(json.qoe);
      return Number.isNaN(qoe) ? null : qoe;
    } catch (err) {
      console.error(`VIDEOMARK: ${err}`);
    }
  }

  async _store_session(video) {
    const storage = useStorage({
      sessionId: this.session_id,
      videoId: video.get_video_id()
    });
    await storage.save({
      user_agent: this.userAgent,
      location: window.location.href,
      media_size: video.get_media_size(),
      domain_name: video.get_domain_name(),
      start_time: video.get_start_time(),
      end_time: -1,
      thumbnail: video.get_thumbnail(),
      title: video.get_title(),
      log: [
        ...(storage.cache.log || []).filter(a => !("qoe" in a)),
        ...video.get_latest_qoe(),
        {
          date: Date.now(),
          quality: {
            ...video.get_quality(),
            viewport: video.get_viewport(),
            resolution: video.get_resolution()
          }
        }
      ]
        .sort(({ date: ad }, { date: bd }) => ad - bd)
        .slice(-Config.max_log)
    });
  }

  /**
   * 送信データフォーマットに変換
   */
  _to_json(video) {
    this.startTime = this.endTime;
    this.endTime = performance.now();
    this.sequence += 1;

    return {
      version: this.version,
      date: new Date().toISOString(),
      startTime: this.startTime,
      endTime: this.endTime,
      session: this.session_id,
      location: window.location.href,
      userAgent: this.userAgent,
      appVersion: this.appVersion,
      sequence: this.sequence,
      video: [video.get()],
      resource_timing: []
    };
  }

  static event_wait(elm, type, ms) {
    let eventResolver;
    const event = new Promise(resolve => {
      eventResolver = resolve;
      elm.addEventListener(type, resolve, false);
    });
    const timeout = new Promise(resolve => setTimeout(() => resolve(null), ms));
    return new Promise(async resolve => {
      const ret = await Promise.race([event, timeout]);
      elm.removeEventListener(type, eventResolver, false);
      resolve(ret);
    });
  }
}
