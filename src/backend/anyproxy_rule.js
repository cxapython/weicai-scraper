'use strict'
console.log("load anyproxy_rule")
const querystring = require('querystring')
const url = require('url')

var escape2Html = function(str) {
  var arrEntities = { 'lt': '<', 'gt': '>', 'nbsp': ' ', 'amp': '&', 'quot': '"' };
  return str.replace(/&(lt|gt|nbsp|amp|quot);/ig, function(all, t) { return arrEntities[t]; });
}

var requestStrToMap = function(e) {
  var t = []
  let params = new URLSearchParams(e)
  params.forEach((value, name, searchParams) => {
    t[name] = value
  })
  return t
}

var saveMutiMsg = async function(dateTime, msgList) {
  for (let sub_msg of msgList) {
    let result = await saveMsg(dateTime, sub_msg)
    if (result == 'limit') {
      break
    }
  }
}

var saveMsg = async function(dateTime, msg) {
  msg.content_url = msg.content_url.replace(/&amp;/g, '&')
  let linkParse = querystring.parse(url.parse(msg.content_url).query);
  let msgBiz = linkParse.__biz;
  let msgMid = linkParse.mid;
  let msgIdx = linkParse.idx;
  let msgSn = linkParse.sn;
  let info = {
    'msg_biz': msgBiz,
    'msg_mid': msgMid,
    'msg_idx': msgIdx,
    'msg_sn': msgSn,
    'title': msg.title,
    'content_url': msg.content_url,
    'cover': msg.cover,
    'author': msg.author,
    'copyright_stat': msg.copyright_stat,
    'publish_time': dateTime
  }
  return new Promise(async (resolve, reject) => {
    let result = await global.recorder.emitHistorySave(info)
    resolve(result)
  })
}

module.exports = {
  summary: 'a rule to hack response',
  * beforeSendRequest(requestDetail) {
    if (requestDetail.url.indexOf('/injectJs.js') >= 0) {
      const newRequestOptions = requestDetail.requestOptions;
      newRequestOptions.protocol = 'http:';
      newRequestOptions.hostname = '127.0.0.1'
      newRequestOptions.port = '6877';
      newRequestOptions.path = '/statics/index.js';
      newRequestOptions.method = 'GET';
      return newRequestOptions;
    }
  },
  * beforeDealHttpsRequest(requestDetail) {
    return true;
  },
  * beforeSendResponse(requestDetail, responseDetail) {
    if (responseDetail.response.statusCode == 500 ||
      responseDetail.response.statusCode == 404
    ) {
      return new Promise((resolve, reject) => {
        resolve({ response: responseDetail.response });
      });
    }
    console.log(requestDetail.requestOptions.path)
    if (requestDetail.requestOptions.hostname === 'mp.weixin.qq.com') {
      let content = responseDetail.response.body.toString()
      // 异常结果
      let error_msg = "操作频繁，请稍后再试";
      if (content.indexOf(error_msg) >= 0) {
        console.log('微信提示: ' + error_msg)
        return new Promise((resolve, reject) => {
          resolve({ response: responseDetail.response });
        });
      }
      if (/^\/mp\/profile_ext\?action=home/.test(requestDetail.requestOptions.path)) {
        // 正则匹配到JSON
        let cpr = /var msgList = '(.+)';\n/.exec(content)
        if (cpr != null) {
          let contentJSON = cpr[1];
          // 转义为正常字符
          contentJSON = escape2Html(contentJSON).replace(/\\\//g, "/");
          let contentJs = JSON.parse(contentJSON);

          let list = contentJs.list;
          for (let msg of list) {
            //1 纯文本 49 富文本
            if (msg.comm_msg_info.type != 49) {
              continue
            }
            let dateTime = (msg.comm_msg_info.datetime * 1000).toString();
            if (msg.app_msg_ext_info.is_multi) {
              saveMutiMsg(dateTime, msg.app_msg_ext_info.multi_app_msg_item_list)
            } else {
              saveMsg(dateTime, msg.app_msg_ext_info)
            }
          }

        }
      }
      if (/^\/mp\/profile_ext\?action=getmsg/.test(requestDetail.requestOptions.path)) {
        console.log('提取上拉加载的数据')
        let contentJs = JSON.parse(content);
        let generalMsgList = JSON.parse(contentJs.general_msg_list);
        let list = generalMsgList.list;
        for (let msg of list) {
          //1 纯文本 49 富文本
          if (msg.comm_msg_info.type != 49) {
            continue
          }
          let dateTime = (msg.comm_msg_info.datetime * 1000).toString();
          if (msg.app_msg_ext_info.is_multi) {
            saveMutiMsg(dateTime, msg.app_msg_ext_info.multi_app_msg_item_list)
          } else {
            saveMsg(dateTime, msg.app_msg_ext_info)
          }
        }
      }
      if (/^\/mp\/getappmsgext/.test(requestDetail.requestOptions.path)) {
        console.log('提取阅读量数据')
        let contentJs = JSON.parse(content);
        let data = requestStrToMap(requestDetail.requestData.toString())

        let msgBiz = data['__biz'];
        let msgMid = data['mid'];
        let msgIdx = data['idx'];
        let msgSn = data['sn'];
        let title = decodeURIComponent(data['title']);

        if ('appmsgstat' in contentJs) {
          // 阅读量
          let readNum = contentJs.appmsgstat.read_num;
          // 点赞量
          let likeNum = contentJs.appmsgstat.like_num;
          let comment_count = contentJs.comment_count
          //contentJs.appmsgticket.ticket
          //contentJs.base_resp.wxtoken
          // 赞赏量，若没有，赋值0
          let rewardTotalCount = contentJs.reward_total_count || 0;
          let info = {
            'msg_biz': msgBiz,
            'msg_mid': msgMid,
            'msg_idx': msgIdx,
            'msg_sn': msgSn,
            'title': title,
            'readNum': readNum,
            'likeNum': likeNum,
            'comment_count': comment_count,
            'rewardTotalCount': rewardTotalCount
          }
          global.recorder.emitSave(info)
        }
      }
      // 提取评论数据
      if (/^\/mp\/appmsg_comment\?action=getcomment/.test(requestDetail.requestOptions.path)) {
        console.log('提取评论数据')
        let contentJs = JSON.parse(content);
        let data = requestStrToMap(requestDetail.requestOptions.path.toString())
        if (contentJs.base_resp.ret == 0) {
          let info = {
            'comment_id': data.comment_id,
            'elected_comment': contentJs.elected_comment,
            'elected_comment_total_cnt': contentJs.elected_comment_total_cnt
          }
          global.recorder.emitCommentsSave(info)
        }
      }
      if (responseDetail.response.statusCode == 200 &&
        'Content-Type' in responseDetail.response.header &&
        responseDetail.response.header['Content-Type'].indexOf('/html') >= 0) {
        console.log('处于代理模式-注入辅助脚本')
        const newResponse = responseDetail.response;
        let newContent = newResponse.body.toString()
        let injectJs = '<script src="https://mp.weixin.qq.com/injectJs.js" type="text/javascript" async=""></script>'
        newResponse.body = newContent.replace("<!--headTrap<body></body><head></head><html></html>-->", "").replace("<!--tailTrap<body></body><head></head><html></html>-->", "")
          .replace("</body>", injectJs + "\n</body>");
        return new Promise((resolve, reject) => {
          resolve({ response: newResponse });
        });
      }

      return new Promise((resolve, reject) => {
        resolve({ response: responseDetail.response });
      });
    }
  },
};
