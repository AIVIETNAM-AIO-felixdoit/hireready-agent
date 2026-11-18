# HANDOFF: HireReady Agent

> Ghi chú bàn giao để người clone repo về (hoặc chính mình sau này) nắm lại project nhanh.
> Cập nhật lần cuối: 19/11/2026.

## 1. Tóm tắt 30 giây

**HireReady Agent** là app web nhận một tin tuyển dụng (JD) và một CV. Agent chạy nhiều bước:

**Parse → Gap analysis → Draft → Critic ⇄ Revise → Cover letter và interview prep**

Điểm nhấn là **critic agent**: một agent riêng chấm điểm bản CV mới và **so từng câu với CV gốc để bắt chỗ bịa**. Bản nào có câu bịa thì writer phải sửa lại.

Project làm cho **Agentic Hackathon** trên Devpost (https://agentic-hackathon.devpost.com/), hạn nộp 00:45 ngày 12/11/2026 (GMT+7). Làm cho vui là chính: cuộc thi dành cho Bangladesh và yêu cầu đội 3–4 người.

| | Link |
| --- | --- |
| Live demo | https://hireready-agent.vercel.app/ |
| Repo | https://github.com/AIVIETNAM-AIO-felixdoit/hireready-agent |
| Video demo (có giọng đọc) | https://youtu.be/bycZieLlX6w |
| Bài nộp Devpost (văn bản) | [`SUBMISSION.md`](SUBMISSION.md) |

## 2. Trạng thái hiện tại

- ✅ App chạy ổn trên Vercel. Một lượt agent mất khoảng 60–90 giây (giới hạn của Vercel là 300 giây).
- ✅ README đầy đủ ảnh, GIF, sơ đồ. Đã có video có giọng đọc, thumbnail và 8 ảnh gallery cho Devpost.
- ⚠️ Dòng nói về **Devin** trong `SUBMISSION.md` vẫn là placeholder `(fill in: ...)`. Trong quá trình làm **không dùng Devin**, nên sửa cho đúng hoặc xóa đi.
- ⚠️ Model hay chấm không đạt ngưỡng 85 điểm và 0 câu bịa trong 3 vòng, nên agent thường dừng vì hết số vòng sửa rồi chọn bản tốt nhất. Đây là hành vi mong muốn, không phải lỗi.

## 3. Chạy lại sau khi clone

```bash
git clone https://github.com/AIVIETNAM-AIO-felixdoit/hireready-agent.git
cd hireready-agent
npm install
cp .env.example .env.local     # rồi điền key (mục 4)
npm run dev                    # http://localhost:3000 → Load sample → Run agent
```

`.env.local` **không có trên GitHub**, phải tự tạo lại. Bản gốc đang được giữ ở `D:\agentic hackathon\.env.local`.

## 4. Cấu hình model và API key

Code chọn nhà cung cấp trong [`lib/llm.ts`](lib/llm.ts):
- Nếu có `LLM_BASE_URL` và `LLM_API_KEY` thì dùng nhà cung cấp đó (bất kỳ API nào tương thích OpenAI).
- Nếu không thì dùng OpenRouter.
- Key mà người dùng tự dán trong **Settings** của UI luôn được coi là key OpenRouter.

**Cấu hình đang chạy trên Vercel (Meta Model API):**

```
LLM_BASE_URL=https://api.meta.ai/v1
LLM_API_KEY=<key Meta>
LLM_MODEL=muse-spark-1.3
LLM_REASONING_EFFORT=minimal
```

**Dự phòng (OpenRouter):** `OPENROUTER_API_KEY`, `OPENROUTER_MODEL=nvidia/nemotron-3.5-super-vl:free`.

### Những điều đã rút ra về các nhà cung cấp

| Chủ đề | Ghi chú |
| --- | --- |
| **Meta Model API** | Base URL là **`https://api.meta.ai/v1`**, không phải `api.llama.com` (dùng URL đó sẽ bị 401). Model chữ có: `muse-spark-1.3` (mạnh, có reasoning), `muse-ember-1.0` (nhanh gấp khoảng 3 lần). Credit **$150 miễn phí** từ một cuộc thi khác. Lưu ý: khi dùng free credit, *nội dung gửi lên có thể được Meta dùng để cải thiện sản phẩm*, nên đừng quảng bá cho người khác dán CV thật. |
| `reasoning_effort` | `muse-spark-1.3` không nhận `none`, chỉ nhận `minimal \| low \| medium \| high \| xhigh \| max`. Dùng `minimal` cho nhanh. |
| **OpenRouter free** | Key free tier: **50 request/ngày** cho model `:free`, reset lúc 07:00 giờ VN. Một lượt agent tốn khoảng 10–12 request, tức chỉ chạy được khoảng 4 lượt/ngày. |
| **NVIDIA Nemotron (free)** | Bật reasoning thì chậm hơn khoảng 7 lần (một lượt mất hơn 6 phút, vượt giới hạn Vercel). Code tự gửi `reasoning: {enabled:false}` cho OpenRouter, đặt `OPENROUTER_REASONING=on` để bật lại. Chấm điểm khá thất thường. |
| JSON mode | Có nhà cung cấp không nhận `response_format: json_object`. Khi gặp lỗi 400/422, code tự bỏ tham số này và dùng `parseJson()` (đọc được cả JSON trong khối ```json) cộng một lần nhờ model sửa lại. |

## 5. Kiến trúc

```
app/page.tsx            UI client: ô nhập liệu, trace trực tiếp, 4 tab kết quả
app/api/agent/route.ts  POST: stream NDJSON các AgentEvent · GET: thông tin provider/model
lib/agent.ts            toàn bộ workflow của agent (runAgent)
lib/llm.ts              client tương thích OpenAI: chọn provider, retry, sửa JSON
lib/samples.ts          JD và CV mẫu (Junior Full-Stack @ bKash, CV "Rahim Uddin")
docs/images/            ảnh dùng trong README
scripts/demo/           script quay video và chụp ảnh (xem scripts/demo/README.md)
```

**Luồng sự kiện:** route gọi `runAgent(input, emit)`. Mỗi lần `emit` ghi một dòng JSON ra stream:
- `step`: id, label, status `running|done|error`, detail
- `result`: key là một trong `job, candidate, gap, baseline, critique, best, cv, letter, prep`
- `error`
- `done`

UI đọc stream từng dòng và cập nhật state theo.

**Các bước trong `lib/agent.ts`:**
1. Parse JD và CV **song song** (2 lệnh gọi trả JSON).
2. Gap analysis.
3. Viết bản nháp CV **song song với** chấm điểm CV gốc (`critic(input.cv)`).
4. Vòng lặp tối đa 3 lần chấm, tức 2 lần sửa: `critic(draft)`. Đạt khi `score >= 85` **và** không có câu bịa. Không đạt thì writer sửa với chỉ dẫn "MINIMAL edits".
5. Chọn **bản tốt nhất**: ít câu bịa nhất trước, rồi đến điểm cao nhất (không nhất thiết là bản cuối).
6. Cover letter và interview prep **song song**.

## 6. Các quyết định quan trọng và lý do

- **Hai thang điểm phải giống nhau.** Ban đầu điểm CV gốc lấy từ bước gap analysis còn điểm CV mới do critic chấm, nên có lúc trông như CV bị viết tệ đi (68 → 55). Giờ cả hai đều dùng hàm `critic()` cùng một rubric (keywords 40, relevance 30, summary/structure 15, clarity 15). Điểm "Original CV" trên UI lấy từ `baseline`.
- **Giữ bản nháp tốt nhất** thay vì bản cuối, vì có lần vòng sửa cuối làm điểm tụt từ 80 xuống 56 và thêm câu bịa.
- **Không có database** để không lưu CV của người dùng. Key người dùng tự dán chỉ nằm trong localStorage.
- **`.grid` có `min-height: calc(100vh - 32px)`** để trang cuộn được xuống phần trace khi agent bắt đầu chạy, nếu không trace bị khuất dưới đáy màn hình.
- **Next.js 15.5.29 và React 19.1.10:** Vercel **chặn deploy** bản Next 15.5.4 vì CVE-2025-66478. `npm audit` vẫn báo postcss và sharp, nhưng đó là thư viện phụ dùng lúc build, Vercel không chặn.

## 7. Video demo và ảnh

- Video được **quay tự động** bằng Playwright và **dùng agent chạy thật**. Những đoạn chờ model được ffmpeg tua nhanh gấp 8 lần. Giọng đọc là edge-tts, giọng `en-US-AndrewNeural`, kèm phụ đề trên màn hình.
- Ảnh gallery được chụp bằng cách **phát lại một lần chạy thật đã ghi lại** (không tốn API), với độ trễ 7 giây mỗi bước để thời gian hiển thị giống thực tế.
- File gốc (video MP4, ảnh 1800×1200) nằm ở `D:\agentic hackathon\demo\` và **không có trên git**.
- Cách quay lại: xem [`scripts/demo/README.md`](scripts/demo/README.md).

## 8. Bẫy đã gặp, đừng lặp lại

- **Build lại khi `next start` đang chạy** thì server cũ trả 400 cho các file JS, trang không hydrate được và nút bấm không phản hồi. Phải tắt server trước khi build.
- Trên Windows, `TaskStop`/Ctrl+C đôi khi không tắt được tiến trình `node`, cổng vẫn bị chiếm. Kiểm tra bằng `Get-NetTCPConnection -LocalPort 3123` rồi `Stop-Process`.
- Khi viết script bằng heredoc lồng trong template string, `\d` có thể bị mất dấu `\` (từng làm regex `#(\d)` thành `#(d)`). Viết regex bằng Edit hoặc dùng `[2-9]`.
- Git cảnh báo LF/CRLF trên Windows là bình thường, bỏ qua được.

## 9. Ý tưởng làm tiếp

- Upload CV dạng PDF/DOCX (hiện chỉ nhận dán chữ hoặc file .txt/.md).
- Theo dõi nhiều hồ sơ ứng tuyển cùng lúc.
- Extension trình duyệt: tailor CV ngay trên trang tin tuyển dụng của LinkedIn hoặc BDJobs.
- Thêm rate limit hoặc bắt người dùng tự nhập key trên bản public, để không đốt hết credit Meta.
- Cho phép chọn model trong Settings khi dùng provider `LLM_*` (hiện ô Model chỉ áp dụng cho OpenRouter).
