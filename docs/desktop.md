# Máy đăng Facebook và tương tác có duyệt

## Trạng thái triển khai

Đã có thành phần desktop chạy bằng Node.js/Playwright, profile riêng cho từng tài khoản, ghép nối máy với workspace, kiểm tra phiên, nút xác nhận đúng tài khoản, nhận lịch tự động và ghi kết quả. Windows và macOS có bộ cài một lần tải từ website, mang theo Node.js và chạy nền. Bản chạy thủ công vẫn dùng Node.js 24 và mã nguồn.

## Ứng dụng nền Windows: cài một lần

1. Trên máy Windows 10/11 x64 sẽ chạy Facebook, đăng nhập web và mở **Máy đăng & Facebook → Tải bộ cài Windows**.
2. Mở `Cai-Nhip-Dang.cmd` vừa tải. Không cần quyền quản trị, Node.js hoặc mã nguồn. File có mã ghép nối dùng một lần trong 15 phút; giữ kín và không gửi cho người khác. Nếu mã hết hạn, tải bộ cài mới. Windows có thể hỏi xác nhận mở file tải từ Internet.
3. Bộ cài kiểm tra SHA-256, tải runtime và ứng dụng vào `%LOCALAPPDATA%\NhipDang`, dùng Edge/Chrome có sẵn hoặc cài Chromium nếu cần. Dữ liệu và profile nằm trong `data/`; không được tải lên website. Ứng dụng tự mở website sau khi cài xong.
4. Chọn máy có tên kết thúc bằng `(ung dung nen)`, kết nối và đăng nhập Facebook lần đầu cho từng tài khoản. Kiểm tra đúng danh tính rồi bật các quyền tự động bạn muốn dùng.
5. Những lần sau chỉ thao tác trên website. Ứng dụng tự chạy khi **đăng nhập Windows** (không chạy trước khi đăng nhập), tự thử lại khi lỗi mạng hoặc tiến trình lỗi. Máy tắt/ngủ không thể nhận lệnh; lịch được giữ theo cơ chế hiện có. Không cần mở file CMD hằng ngày.

Nút **Kết nối lại** mở ứng dụng đã cài qua `nhipdang://start`. Cho phép trình duyệt mở Nhịp Đăng nếu được hỏi. Nút này tác động lên máy đang mở website, không bật được máy tính đã tắt hay một máy khác. Không mở cổng điều khiển local và không truyền khóa qua URL này.

Nếu đã bấm **Ngắt kết nối**, vào **Máy đăng & Facebook → Cài máy đăng**, tải bộ cài mới và mở lại trên máy muốn dùng. Không cần gỡ ứng dụng; bộ cài giữ dữ liệu/profile và ghép nối khóa mới. Sau đó chọn máy mới ở từng tài khoản, bấm **Dùng máy này**, kiểm tra phiên và xác nhận quyền tự động. Khi chỉ muốn dừng nhận lịch tạm thời, dùng **Tạm dừng**.

**Chuyển từ bản chạy thủ công:** tạm dừng máy cũ trên web và dừng runner cũ. Cài ứng dụng nền, chọn máy mới tại từng tài khoản rồi bấm **Dùng máy này**. Ứng dụng nền dùng thư mục dữ liệu riêng, cần đăng nhập Facebook ở lần đầu; không tự sao chép cookie/profile đang dùng. Profile cũ được giữ nguyên. Không chạy đồng thời hai runner cho cùng một thư mục dữ liệu.

**Gỡ tự khởi động:** trong Start Menu, chọn **Nhip Dang → Go cai dat**. Ứng dụng dừng runner qua IPC để đóng trình duyệt và lưu phiên, bỏ mục Startup và liên kết mở từ web. Profile và dữ liệu vẫn được giữ. **Ngắt kết nối** trên web thu hồi khóa; muốn ghép nối lại, tải và mở lại bộ cài. Nhật ký lỗi nằm ở `data/desktop.log`, tối đa 5 MiB mỗi file trước mỗi lần khởi động runner và giữ một bản trước đó. Bản đang chạy vẫn có thể ghi vượt mức này cho tới lần khởi động tiếp theo.

**Chuẩn bị bộ cài khi triển khai:** chạy `npm run desktop:bundle` trước `npm run build`. Lệnh tải Node.js Windows x64 phiên bản cố định và kiểm tra checksum từ nodejs.org, đóng gói đúng runner hiện tại cùng Playwright, không kèm `.env`, khóa kết nối hoặc profile. Release và manifest nằm trong `public/downloads/`, được gitignore. Dockerfile tự thực hiện bước này khi build image; cần Internet để tải runtime. Với bản standalone, giữ thư mục `public/downloads` cạnh `server.js`. Khi cập nhật ứng dụng nền, tải bộ cài mới rồi đăng xuất/đăng nhập lại Windows để dùng phiên bản mới.

## Kết nối nhanh trên Windows chạy local

Trong **Tài khoản Facebook** hoặc **Máy đăng & Facebook**, chọn tài khoản rồi bấm **Kết nối Facebook**. Ứng dụng tự khởi động máy đăng nền, khôi phục profile đã lưu và kiểm tra phiên Facebook. Lần đầu, đăng nhập, hoàn tất 2FA nếu có rồi bấm **Xác nhận đúng tài khoản**; ứng dụng tự nhận biết phiên trong tối đa 10 phút. Những lần sau, nếu vẫn đúng tài khoản đã xác nhận trên cùng máy đăng, ứng dụng chuyển sang **Đã kết nối Facebook** và giữ lựa chọn tự đăng mà không yêu cầu xác nhận lại. Phiên hết hạn, đăng xuất hoặc Facebook yêu cầu xác minh sẽ dừng tự đăng và hiện hướng dẫn tương ứng. Không cần sao chép lệnh hay ghép nối máy thủ công. Nếu đăng nhập lâu hơn 10 phút, bấm **Kiểm tra lại**.

Máy đăng nền dùng Edge/Chrome đã cài hoặc Chromium của Playwright; `NHIPDANG_BROWSER_CHANNEL` được ưu tiên nếu đã cấu hình. Cấu hình kết nối local nằm trong `.data/desktop/local-<hash>/`. Cả chạy bằng `Start-Desktop.cmd` và kết nối từ giao diện dùng chung cách tìm profile: ưu tiên profile local cũ của tài khoản nếu có, sau đó dùng `.data/desktop/profiles/<workspace>/<hash-tài-khoản>/`. Profile được dùng tại chỗ, không sao chép hoặc gộp; profile mới được tạo trong thư mục chung. `NHIPDANG_DESKTOP_DIR` đổi thư mục gốc cho cả hai cách chạy. Trình duyệt được mở với khôi phục phiên trước để giữ cả cookie phiên sau khi đóng và mở lại. Dùng **Đóng cửa sổ** hoặc Ctrl+C khi dừng máy đăng để trình duyệt lưu dữ liệu trước khi thoát. Lần sau bấm kết nối sẽ dùng lại hoặc khởi động lại tiến trình này. Bật **Cho phép tự đăng bài đã lên lịch** khi muốn dùng lịch tự động; kết nối Facebook không tự bật lựa chọn này.

Runner cũng đọc lựa chọn `browserChannel` (`chrome` hoặc `msedge`) trong file `connection.json` trên máy. Lựa chọn được giữ khi ghép nối lại cùng server/workspace; biến môi trường vẫn có ưu tiên cao hơn. Khi chuyển runner sang ứng dụng nền trên cùng máy, phải dùng đúng trình duyệt đã tạo profile. Có thể dùng junction tới profile gốc sau khi dừng cả hai runner; giữ nguyên thư mục gốc và không chạy đồng thời hai runner vào cùng profile.

Trên Windows, profile có đường dẫn dài được mở qua junction ngắn trong `.data/desktop/browser-profiles/` để tránh giới hạn đường dẫn của bộ nhớ đệm và lưu trữ mạng Chrome. Junction trỏ tới thư mục profile gốc; không chứa bản sao cookie. Giữ cả thư mục gốc và junction khi dùng ứng dụng.

Kết nối trực tiếp chỉ có khi máy chủ ứng dụng chạy trên Windows với `BETTER_AUTH_URL` là localhost/127.0.0.1. Có thể tắt bằng `NHIPDANG_LOCAL_DESKTOP=0`. Khi triển khai web lên VPS, Windows và MacBook dùng bộ cài một lần; bản chạy thủ công dùng **Kết nối máy mới (nâng cao)**. **Kết nối máy khác** là tùy chọn nâng cao trên bản local.

Adapter Facebook hỗ trợ văn bản/ảnh và nhãn giao diện tiếng Việt/Anh. Kiểm thử tự động sử dụng giao diện mô phỏng trong trình duyệt. Giao diện, quyền đăng và luồng duyệt của Facebook có thể khác. Không có tần suất bảo đảm tránh hạn chế Facebook.

## Windows công ty và MacBook ở nhà

Hai máy dùng chung web VPS (ví dụ `https://autotool.pmcoding.com`), không tạo hai database local. Mỗi máy giữ profile Facebook và khóa ghép nối riêng. Không sao chép `.env`, `.data/desktop/connection.json` hoặc profile Windows sang Mac.

### Ứng dụng nền MacBook: cài một lần

1. Trên MacBook chạy macOS 14 trở lên (Apple Silicon hoặc Intel), đăng nhập web VPS, mở **Máy đăng & Facebook → Tải bộ cài MacBook**.
2. Giải nén `Cai-Nhip-Dang-Mac.zip`, mở `Cai-Nhip-Dang.command` trong vòng 15 phút. File có mã ghép nối dùng một lần; giữ kín file. Nếu macOS chặn, kiểm tra đúng nguồn website rồi dùng tùy chọn Mở/Privacy & Security của macOS nếu được phép. Không tắt Gatekeeper.
3. Bộ cài tự chọn chip, tải Node.js 24 đã kiểm tra SHA-256 và cài Chromium. Không cần Node.js, mã nguồn hay database riêng. Giữ mạng trong lần cài đầu.
4. Website mở lại sau khi cài. Chọn Mac tại tài khoản và bấm **Dùng máy này** (hoặc **Kết nối Facebook** nếu chưa có kết nối). Đăng nhập Facebook lần đầu, xác nhận danh tính rồi bật quyền tự động cần dùng.
5. Những lần sau ứng dụng tự chạy khi **đăng nhập macOS**. Chỉ cần dùng website; có thể mở `~/Applications/Nhip Dang.app` hoặc bấm **Kết nối lại** nếu cần. Mac phải bật, không ngủ và có mạng.

Ứng dụng và phiên nằm tại `~/Library/Application Support/NhipDang/`; dữ liệu riêng trong `data/`, trình duyệt trong `browsers/`. Tự khởi động dùng LaunchAgent cá nhân `~/Library/LaunchAgents/com.nhipdang.desktop.plist`, không cần quyền quản trị. Ứng dụng được tạo và ký ad hoc tại máy, chưa có chữ ký Developer ID/notarization. Bộ cài giữ các kiểm tra bảo mật của macOS.

**Cập nhật:** tải bộ cài mới từ cùng tài khoản web và mở lại; kết nối/profile đang lưu được giữ. Nếu ứng dụng đang chạy, đăng xuất/đăng nhập macOS để áp dụng bản mới sau khi công việc kết thúc. **Gỡ:** mở `~/Applications/Go Nhip Dang.command`; tự khởi động và ứng dụng được gỡ, dữ liệu/profile được giữ. Log ở `data/desktop.log`, `data/background.log` và `data/background.error.log`. Bộ cài đã kiểm tra bằng kiểm thử tự động; vẫn cần kiểm chứng cài đặt trên Mac thật.

### Bản mã nguồn (tùy chọn nâng cao)

Cài Node.js 24, lấy cùng phiên bản mã nguồn. Trong Terminal tại thư mục ứng dụng:

```sh
npm ci
npx playwright install chromium
chmod +x Start-Desktop.command
```

Mở **Máy đăng & Facebook → Kết nối máy mới** trên web VPS, chạy lệnh ghép nối hiển thị trong Terminal của MacBook. Sau đó chọn MacBook tại tài khoản và bấm **Dùng máy này** (hoặc **Kết nối Facebook** nếu chưa có kết nối nào). Lần đầu đăng nhập trực tiếp Facebook, xác nhận đúng tài khoản và bật các quyền tự động cần dùng. MacBook chỉ chạy runner, không cần PostgreSQL hoặc `local:init`.

Với bản mã nguồn, những lần sau mở `Start-Desktop.command` hoặc `npm run desktop`. Với cả hai bản, chọn máy muốn dùng rồi bấm **Dùng máy này**. Máy phải online; app đợi công việc và lệnh đang xử lý kết thúc trước khi cho chuyển. Phiên được kiểm tra lại, sau đó khôi phục xác nhận và các quyền đã lưu riêng trên máy đó nếu vẫn đúng danh tính. Máy mới mặc định tắt quyền tự động. Đóng trình duyệt đúng cách/Ctrl+C để lưu phiên. Facebook vẫn có thể yêu cầu đăng nhập lại, 2FA hoặc PIN.

Mỗi tài khoản chỉ có một máy hoạt động; máy cũ tự bật lại không giành tài khoản. Lịch và kết quả ở chung VPS. Công việc cần kiểm tra kết quả vẫn được giữ khi chuyển máy.

## Tin nhắn trên máy đang dùng

Tin nhắn dùng luôn profile đã xác nhận trên máy đăng. Không cần đăng nhập thêm vào trình duyệt VPS. Chọn từng tài khoản tại **Tin nhắn** để xem máy nguồn và lần quan sát cuối. Runner dùng tab theo dõi riêng, kiểm tra khoảng 30 giây lúc rảnh, ưu tiên bài đăng/tương tác. Không mở hội thoại hay gửi tin; danh sách chỉ gồm các hội thoại đã quan sát được. PIN, checkpoint và giao diện chưa hỗ trợ có trạng thái riêng.

Khi hai máy đều tắt/ngủ, Tin nhắn dừng cập nhật. Dữ liệu cũ giữ tối đa 24 giờ; chỉ hiện đang theo dõi khi máy còn online và có quan sát thành công trong 90 giây. Không bật lại quyền tự động nếu phiên đã mất hoặc sai danh tính. Runner cũ hiển thị yêu cầu cập nhật; cần cập nhật cả web và runner.

## Thiết lập cho 5 tài khoản

1. Thêm 5 tài khoản tại **Tài khoản Facebook**, điền đúng link cá nhân và tên dễ nhớ.
2. Mở **Máy đăng & Facebook → Kết nối máy mới**. Chạy lệnh được cung cấp trong terminal ở thư mục ứng dụng trên máy sẽ chạy Facebook. Mã dùng một lần trong 5 phút; không chia sẻ lệnh này.
3. Lần đầu cài trình duyệt bằng `npx playwright install chromium`. Có thể đặt `NHIPDANG_BROWSER_CHANNEL=chrome` hoặc `msedge` để dùng trình duyệt đã cài; ứng dụng vẫn tạo thư mục profile riêng.
4. Trên từng tài khoản, bấm **Kết nối Facebook**. Một cửa sổ profile riêng mở ra. Nhập mật khẩu/2FA trực tiếp trên Facebook; không gửi các thông tin này qua webapp.
5. Ứng dụng tự nhận biết khi đăng nhập xong. Kiểm tra tên, ảnh và link cá nhân trong cửa sổ Facebook rồi bấm **Xác nhận đúng tài khoản**.
6. Bật **Cho phép tự đăng bài đã lên lịch**. Lặp lại cho các tài khoản còn lại.
7. Soạn bài, lên lịch và chọn **Tự đăng bằng máy đã kết nối**. Chọn từng tài khoản/nhóm đã liên kết và kiểm tra nội quy trước khi lưu.

Windows đã cài ứng dụng nền chỉ cần đăng nhập Windows, giữ máy hoạt động và có mạng. Với bản chạy thủ công, lần sau chạy `npm run desktop` hoặc mở `Start-Desktop.cmd` và giữ terminal. Máy chủ web và PostgreSQL cũng cần hoạt động. Máy đăng nhận tuần tự từng bài, áp dụng giờ nghỉ, mức công việc/ngày và khoảng cách nhóm đã cấu hình. Nếu máy offline, công việc chưa chạy vẫn được giữ và xử lý khi máy trở lại; công việc quá hạn có thể được chạy ngay khi các điều kiện cho phép.

Khi web chuyển lên VPS, desktop kết nối ra domain HTTPS của VPS. Không mở cổng điều khiển trình duyệt từ máy local ra Internet. Không cài desktop trên VPS không có giao diện. Cấu hình kết nối nằm trong `.data/desktop/connection.json`; profile Facebook trong `.data/desktop/profiles/<workspace>/…`. Giữ kín cả thư mục này. Có thể chuyển vị trí bằng `NHIPDANG_DESKTOP_DIR`.

## Theo dõi và xử lý lỗi

Nếu máy đăng ngoại tuyến, yêu cầu mở/kiểm tra/đóng cửa sổ chưa được nhận sẽ tự kết thúc khi trang cập nhật trạng thái. Yêu cầu chờ hoặc đang xử lý quá 2 phút cũng kết thúc với thông báo để bạn kiểm tra và thử lại. Yêu cầu đã quá hạn không được chạy lại khi máy trở về. Với ứng dụng nền, bật máy, đăng nhập Windows và chờ tự kết nối; có thể bấm **Kết nối lại** trên chính máy đó. Trên bản web local, bấm **Kết nối Facebook** để bật lại máy đăng; bản thủ công vẫn mở `Start-Desktop.cmd`. Đóng cửa sổ thành công giữ phiên Facebook trên máy và không hiển thị tiếp lời nhắc đăng nhập của cửa sổ cũ.

Khoảng cách đăng được cấu hình theo **phút**. Trong **Tài khoản Facebook**, đặt khoảng cách giữa các bài của từng tài khoản (mặc định 5 phút, áp dụng cả khi khác nhóm/lịch). Trong **Hội nhóm**, đặt khoảng cách đăng lại trong cùng nhóm (nhóm mới mặc định 5 phút, áp dụng chung cho các tài khoản). Có nút chọn nhanh 3/5/10/15 phút và ô nhập tùy chỉnh. Khi tạo lịch nhiều nơi, khoảng cách giữa các nơi đăng mặc định 5 phút. Đây là thiết lập công việc, không phải ngưỡng an toàn được Facebook xác nhận.

Các cấu hình giờ cũ được chuyển sang phút với cùng thời lượng khi nâng cấp (24 giờ thành 1440 phút). File CSV mới dùng `minIntervalMinutes`; cột `minIntervalHours` cũ vẫn được chuyển đổi. Lịch bị giữ bởi khoảng cách sẽ hiển thị lý do và thời điểm sớm nhất có thể nhận. Công việc đã bắt đầu nhưng chưa xác nhận cũng được tính; nếu trước đó chưa đăng, kiểm tra rồi ghi nhận bỏ qua để tránh giữ lịch mới.

Bộ lọc lịch đăng được lưu trong URL: `view`, `date`, `day`, `q`, `accountId`, `status`, `target`, `page`. Tải lại hoặc dùng Back/Forward sẽ khôi phục màn hình tương ứng.

Ở chế độ danh sách, **Hôm nay** lọc đúng ngày hiện tại theo UTC+7. Lịch tháng/tuần tự tải các trang công việc tiếp theo, tránh bỏ sót lịch khi có hơn 100 công việc; dữ liệu tự cập nhật mỗi 15 giây.

Máy đăng chấp nhận chuyển hướng giữa `facebook.com`, `www.facebook.com` và `web.facebook.com` nhưng vẫn kiểm tra đúng nhóm đích và danh tính. Lỗi trước khi gửi giữ tab Facebook để xem nguyên nhân; hủy thao tác hoặc hết thời gian vẫn đóng tab nhằm dừng công việc.

Khi đăng, tab đã ở Facebook được kiểm tra tại chỗ thay vì điều hướng vòng qua `/me`. Runner chờ tài liệu và giao diện soạn bài sẵn sàng, tránh đợi script phụ chưa tải xong; nhóm đích được kiểm tra lại ngay trước khi gửi. Tab theo dõi Tin nhắn đọc dữ liệu trực tiếp và kiểm tra mạng, không tải lại toàn bộ trang mỗi lần quét.

Khi Chrome khôi phục phiên, runner ưu tiên tab Facebook đã có thay vì tab `about:blank` mặc định. Khi tạo tab theo dõi riêng, tab làm việc được đưa về phía trước để tab trắng vừa tạo không che cửa sổ Facebook.

- Tạm dừng máy để ngừng nhận bài tiếp theo; bài đã bắt đầu gửi không thể thu hồi bằng nút tạm dừng.
- Trước khi bấm Đăng, desktop kiểm tra lại danh tính Facebook và xin quyền gửi từ máy chủ. Công việc đã hủy hoặc tài khoản bị tắt tự động sẽ bị chặn trước bước này.
- Bấm nút Đăng thành công trên Facebook sẽ ghi nhận **Đã đăng** ngay, không chờ thông báo, link bài hoặc xác minh lại nội dung. Trạng thái này ghi nhận thao tác gửi; nhóm vẫn có thể yêu cầu quản trị viên duyệt bài.
- Máy đăng chờ trình soạn bài và tải ảnh tối đa 90 giây mỗi bước, toàn bộ một lượt tối đa 4 phút gồm cả tải ảnh từ máy chủ. Khi hết thời gian, thao tác trình duyệt bị hủy; profile và phiên đăng nhập vẫn được giữ.
- Lỗi mạng/timeout chắc chắn trước khi máy chủ cấp quyền gửi được thử tối đa 3 lượt tổng cộng, chờ 1 phút rồi 3 phút sau mỗi lỗi. Giờ hẹn không bị đổi. Trong thời gian chờ, các bài khác đủ điều kiện vẫn được nhận; lịch quá giờ không tự hết hạn. Số lượt và giờ thử lại được lưu qua khởi động lại; khoảng cách đăng, giờ nghỉ và mức công việc/ngày vẫn áp dụng.
- Hết lượt hoặc lỗi không thể tự khắc phục trước khi gửi sẽ hiện **Chưa gửi được**, không chặn hàng đợi. Mở chi tiết rồi bấm **Thử lại** để cấp tối đa 3 lượt mới cho bài được xác định chưa gửi. Lỗi cũ thiếu thông tin xác định an toàn vẫn cần kiểm tra thủ công.
- Nếu đã cấp quyền gửi hoặc đã thử bấm Đăng nhưng không rõ kết quả, bài hiện **Cần kiểm tra** và giữ các lịch tiếp theo của cùng tài khoản; tài khoản khác vẫn hoạt động. Mất phiên hoặc Facebook yêu cầu xác minh sẽ tắt tự đăng và yêu cầu kết nối lại. Mở chi tiết, kiểm tra Facebook rồi ghi nhận kết quả. Không tự chạy lại bài có kết quả chưa rõ.
- Mất kết nối khi đang chuẩn bị được đưa vào chính sách thử lại sau khi lease hết hạn (5 phút); gián đoạn sau khi cấp quyền gửi vẫn cần kiểm tra. Nếu desktop còn lưu được kết quả nhưng mất phản hồi, chỉ gửi lại kết quả trước khi nhận việc mới, không đăng lại bài. Cập nhật cả web, worker và máy đăng để dùng cùng cơ chế phục hồi.
- Không chỉnh sửa tài khoản/nhóm hoặc thao tác thủ công trong profile khi một bài đang được gửi.
- Đổi Facebook trong profile hoặc sửa link tài khoản sẽ yêu cầu kiểm tra và xác nhận lại danh tính.
- Ngắt kết nối máy thu hồi khóa truy cập, dừng nhận lịch; không xóa phiên Facebook trên ổ đĩa máy đó. Muốn xóa phiên, đăng xuất trực tiếp từng profile.

Webapp lưu dấu băm danh tính và dữ liệu xem trước Tin nhắn tối đa 24 giờ; không nhận cookie hoặc mật khẩu Facebook. Sao lưu database/ảnh không bao gồm profile và khóa máy đăng. Máy mới ghép nối và đăng nhập lần đầu; máy đã dùng được kiểm tra lại phiên đã lưu khi chuyển về. Không chạy một bản sao database được restore cùng lúc với bản cũ có các máy đăng còn hoạt động; thu hồi máy cũ hoặc tạm dừng các lịch trước khi chuyển hệ thống.

## Cập nhật phiên bản có chuyển máy và Tin nhắn

1. Đợi công việc hiện tại kết thúc, tạm dừng các máy đăng và dừng runner bằng Ctrl+C.
2. Sao lưu database và ảnh trước migration: local dùng `npm run backup:local`; VPS dùng `sh scripts/backup.sh /duong-dan-backup`.
3. Cập nhật web/worker và chạy migration `20261106090000_desktop_inbox_sessions`. Migration giữ kết nối hiện có và tạo bản ghi phiên cho máy đang dùng; không đụng đến profile trình duyệt.
4. Build/khởi động lại web và worker, cập nhật runner Windows cùng phiên bản rồi khởi động lại. Kiểm tra trạng thái trước khi tiếp tục tự động. Ghép nối MacBook sau đó.
5. Kiểm tra Minh Phan nhận tin thử trên Windows, chuyển sang MacBook, rồi chuyển lại Windows. Kiểm tra khi máy công ty tắt, khi có PIN và khi mạng lỗi. Chưa coi kiểm thử mô phỏng là xác nhận chạy thật trên macOS/Facebook.

Trang Tin nhắn mới không gọi bridge VPS thử nghiệm. Các file và profile trong `.data/inbox-trial` vẫn giữ nguyên; không xóa khi nâng cấp. Có thể dừng riêng container thử nghiệm sau khi đã kiểm chứng nguồn desktop. Nếu cần quay lại bản web cũ, dùng cấu hình bridge cũ; không chạy runner mới với máy chủ cũ. Migration chỉ thêm cấu trúc và giữ dữ liệu kết nối cũ.

## Các lựa chọn tương tác

Mục **Tương tác** cho chọn tài khoản, link bài, giờ nhắc và một loại:

- Bình luận: soạn nội dung để duyệt.
- Bình luận “up”: chuẩn bị nội dung “up”, chỉ thực hiện nếu nội quy cho phép.
- Thả cảm xúc: Thích, Yêu thích, Thương thương, Haha, Wow, Buồn hoặc Phẫn nộ.

Ứng dụng chuẩn hóa link bài để cùng một bài chỉ được giao cho một tài khoản trong workspace, kể cả đổi giữa link mobile, group permalink và link story_fbid. Không hỗ trợ link chia sẻ rút gọn vì chưa xác định được bài gốc. Một công việc đã bỏ qua/hoàn tất vẫn giữ bản ghi tránh trùng.

### Link bài và danh sách hôm nay

Lịch đăng và chi tiết bài hiển thị **Xem bài** hoặc **Chưa lấy được link**. Có thể lưu/sửa permalink bằng thao tác riêng, không đổi kết quả hoặc ngày ghi nhận đăng. Ngay trước thao tác bấm Đăng đã được cấp quyền, máy bắt đầu giữ bằng chứng của lượt gửi: phản hồi tạo bài khớp danh tính, nội dung và nơi đăng; điều hướng mới; hoặc thông báo Xem bài mới. Không lấy bài gần nhất trong bảng tin hay link bài được chia sẻ/đề xuất trong phản hồi. Chỉ đọc phản hồi do chính thao tác gửi tạo ra; không gọi lại yêu cầu tạo bài.

Kết quả Đã đăng được lưu và đồng bộ trước, sau đó hoàn tất lấy link trong tối đa 10 giây. Bằng chứng tạm được giữ qua thời gian đợi xác nhận kết quả (tối đa 45 giây), nên thông báo đã biến mất vẫn có thể được dùng. Khi mạng lỗi, công việc lấy link được giữ trên máy và xử lý sau khi kết quả gửi được xác nhận, trước khi nhận bài tiếp theo. Khởi động lại mất bằng chứng thì ghi lý do gián đoạn, không tự mở lại hay gửi lại bài. Chỉ lưu permalink/lý do và mã lượt; không lưu nội dung phản hồi Facebook, cookie hoặc mật khẩu. Link thiếu/không chắc chắn có lý do trong lịch sử thao tác để bổ sung thủ công; kết quả lấy link đến muộn không ghi đè link người dùng đã sửa. Cơ chế này vẫn cần kiểm chứng với giao diện/phản hồi Facebook thật, không bảo đảm mọi lượt gửi đều trả permalink.

Trong **Tương tác → Bài đã đăng hôm nay**, lọc theo ngày ghi nhận Đã đăng (UTC+7), tài khoản đăng và nhóm; bài mới nhất đứng trước. Lịch hẹn hôm qua nhưng ghi nhận hôm nay nằm trong hôm nay. Bài thiếu link, đang chờ duyệt hoặc cần kiểm tra chưa được chọn để tự tương tác. Bài Facebook thực tế vẫn đang chờ quản trị viên duyệt sẽ bị máy từ chối khi mở bài.

### Tự tương tác một lần

1. Tại **Máy đăng & Facebook**, xác nhận đúng tài khoản B rồi bật riêng **Cho phép tự tương tác** và lưu. Mặc định tắt; bật quyền này không bật tự đăng. Mặc định tối đa 10 tương tác/ngày, cách nhau 5 phút, áp dụng giờ nghỉ của tài khoản; giới hạn tương tác không trừ số bài đăng.
2. Trong danh sách bài đã đăng, chọn bài của A, chọn B (khác tài khoản đăng), nội dung/hành động và thời gian, bấm **Lưu để duyệt** rồi **Duyệt tương tác**. Một bài chỉ có một tài khoản phụ trách và một công việc, kể cả sau khi bỏ qua; không lặp theo lịch.
3. Máy dùng đúng profile đã lưu và xử lý tuần tự. Bài đăng đủ điều kiện được ưu tiên. Tương tác chờ khi máy/profile bận, chưa đến giờ, trong giờ nghỉ hoặc đạt giới hạn. Trước thao tác cuối, máy xác minh danh tính, đúng permalink, quyền truy cập và xin quyền máy chủ. Không bấm lại cảm xúc đã chọn; bình luận cùng nội dung của đúng tài khoản được nhận diện chắc chắn thì ghi nhận đã có.
4. Mỗi lượt tối đa 4 phút. Lỗi mạng trước cấp quyền được thử tối đa 3 lượt, chờ 1 phút rồi 3 phút. Lỗi vĩnh viễn/hết lượt hiện **Chưa thực hiện được**. Sau cấp quyền hoặc thử gửi mà chưa rõ kết quả hiện **Cần kiểm tra**, không tự làm lại. Lịch sử lưu từng lượt; lỗi tương tác thông thường không tạm dừng đăng bài. Mất phiên/checkpoint/đổi danh tính yêu cầu xử lý tài khoản và tắt cả hai quyền.

Khi công việc nguồn còn chờ, chạy, thử lại hoặc cần kiểm tra, phải bỏ qua/xử lý công việc trước khi đổi link nguồn. Công việc đang chạy không thể sửa hoặc bỏ qua. Tắt quyền tự tương tác để ngừng nhận công việc mới; thao tác đã cấp quyền có thể đang hoàn tất. Có thể tắt toàn bộ bằng `NHIPDANG_AUTOMATIC_INTERACTIONS=0` trên máy chủ (khởi động lại web và worker); luồng đăng bài vẫn hoạt động. Runner cũ không khai báo hỗ trợ sẽ không nhận tương tác.

### Tương tác thủ công

Các công việc cũ và nút **Thêm tương tác** vẫn mặc định thủ công: thêm → duyệt → mở công việc → **Mở bài bằng đúng profile** → bạn thực hiện trên Facebook → xác nhận. Mở qua desktop tắt tự đăng và tự tương tác của tài khoản để dành profile cho thao tác thủ công; bật lại từng quyền tại Máy đăng khi xong. Với công việc tự động Cần kiểm tra, chỉ xác nhận hoàn tất sau khi đã xem kết quả trên Facebook. Không suy ra kết quả từ việc mở link hay sao chép nội dung.

Giao diện Facebook thay đổi hoặc quyền nhóm khác nhau có thể khiến adapter dừng trước thao tác. Bình luận “up” hoặc tương tác có thể bị Facebook/nội quy nhóm hạn chế. Kiểm chứng trước bằng một công việc đã chọn và được phép; không bật đồng loạt khi chưa kiểm tra. Khi cập nhật: đợi công việc hiện tại kết thúc, tạm dừng máy, sao lưu dữ liệu rồi cập nhật web/worker/runner; giữ nguyên các bài đăng cũ Cần kiểm tra.

## Kiểm thử

`npm run test:integration` kiểm tra ghép nối dùng một lần/hết hạn, token băm/thu hồi, phân quyền giữa workspace, kiểm tra/xác nhận danh tính, tranh chấp nhận lịch, quyền gửi cuối, tạm dừng, kết quả chưa rõ, worker gián đoạn, giờ nghỉ và chống trùng tương tác cho 5 tài khoản.

`npm run test:e2e` kiểm tra trình duyệt với trang Facebook mô phỏng: chỉ bấm một lần sau khi cấp quyền, ghi nhận ngay khi bấm xong dù thiếu thông báo hoặc nhóm chờ duyệt, chờ tải ảnh, đổi danh tính và thu hồi quyền trước khi gửi. Kiểm thử runtime chạy qua TSX giống máy đăng thật. Đây là kiểm thử mô phỏng; không thay thế thử nghiệm trên Facebook thật.
