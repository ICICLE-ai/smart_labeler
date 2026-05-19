import { errorDecoder } from '../utils';
//import * as StreamSaver from 'streamsaver';
// import StreamSaver from 'streamsaver'; // Old, don't know why it stopped working
var downloadStream = async function (systemId, path, destination, zip, onStart, basePath, jwt) {
const StreamSaver = (await import('streamsaver')).default;
    var fileStream = StreamSaver.createWriteStream(destination);
    var url = "".concat(basePath, "/v3/files/content/").concat(systemId, "/").concat(path).concat(zip ? '?zip=true' : '');
    var config = {
        headers: {
            'X-Tapis-Token': jwt,
        },
    };
    return errorDecoder(function () {
        return fetch(url, config).then(function (response) {
            onStart && onStart(response);
            if (!response.body) {
                throw new Error('Download response had no body!');
            }
            var readableStream = response.body;
            // more optimized
            if (window.WritableStream && (readableStream === null || readableStream === void 0 ? void 0 : readableStream.pipeTo)) {
                return readableStream.pipeTo(fileStream);
                //.then(() => console.log('done writing'));
            }
            window.writer = fileStream.getWriter();
            var reader = response.body.getReader();
            var pump = function () {
                return reader
                    .read()
                    .then(function (res) {
                    return res.done
                        ? window.writer.close()
                        : window.writer.write(res.value).then(pump);
                });
            };
            return pump();
        });
    });
};
export default downloadStream;
