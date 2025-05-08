export const runtime = "edge";
import { NextResponse } from "next/server";
import { EmotionAPI } from "@/constants/api"; // API 키 및 엔드포인트 URL이 정의된 파일

// POST: 파일 업로드 및 분석 요청
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("audio_file") as File;
    const userToken = formData.get("user_token") as string; // 외부 JS에서 사용자 토큰을 받아야 함

    if (!file) {
      return NextResponse.json(
        { error: "No audio_file provided" },
        { status: 400 }
      );
    }
    if (!userToken) {
      return NextResponse.json(
        { error: "No user_token provided" },
        { status: 400 }
      );
    }

    // 외부 API에 전달할 FormData 생성
    const apiFormData = new FormData();
    apiFormData.append("bark_file", file); // 외부 API가 기대하는 파일 필드명

    console.log("[Audio Analysis API - POST] Upload Request:", {
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      userToken: userToken,
      targetApi: EmotionAPI.analysisRequestEmo2,
    });

    // 외부 감정 분석 API에 분석 요청
    const uploadResponse = await fetch(EmotionAPI.analysisRequestEmo2, {
      method: "POST",
      headers: {
        "EMO-Client-ID": EmotionAPI.clientId,
        "EMO-Secret-Key": EmotionAPI.secretKey,
        "X-User-Token": userToken,
      },
      body: apiFormData,
    });

    console.log("[Audio Analysis API - POST] Upload API Response Status:", {
      status: uploadResponse.status,
      statusText: uploadResponse.statusText,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error("[Audio Analysis API - POST] Upload Failed:", {
        status: uploadResponse.status,
        statusText: uploadResponse.statusText,
        errorText: errorText,
      });
      return NextResponse.json(
        { error: "Failed to request audio analysis", details: errorText },
        { status: uploadResponse.status }
      );
    }

    // 외부 API의 성공 응답 처리 (예: JSON)
    // Pippo API는 성공 시 분석 요청 ID 등을 반환할 수 있습니다.
    // 여기서는 단순화를 위해 userToken과 파일명을 기반으로 jobId를 생성하지만,
    // 실제로는 외부 API가 제공하는 ID를 사용하거나, DB에 매핑 정보를 저장하는 것이 좋습니다.
    const uploadResultData = await uploadResponse.json().catch(async () => {
      // 만약 json 파싱 실패 시 텍스트로 한번 더 시도 (디버깅용)
      const textResponse = await uploadResponse.text();
      console.warn(
        "[Audio Analysis API - POST] Upload response was not JSON, raw text:",
        textResponse
      );
      return { rawResponse: textResponse }; // 또는 에러 처리
    });
    console.log(
      "[Audio Analysis API - POST] Upload Success Response from external API:",
      uploadResultData
    );

    // jobId로 파일명과 타임스탬프를 조합하여 사용 (간단한 예시)
    // 실제 프로덕션에서는 더 강력한 고유 ID 생성 방식 또는 외부 API 응답의 ID를 사용해야 합니다.
    const jobId = `${userToken}_${file.name}_${Date.now()}`;

    return NextResponse.json({
      success: true,
      message: "Audio analysis requested. Poll for results using the jobId.",
      jobId: jobId, // 이 jobId를 클라이언트가 결과 조회 시 사용
      // 만약 외부 API가 응답으로 file_id 같은 것을 준다면 그것을 jobId로 사용하는 것이 더 좋습니다.
      // 예를 들어, uploadResultData?.data?.file_id
    });
  } catch (error) {
    console.error("[Audio Analysis API - POST] Error:", error);
    return NextResponse.json(
      {
        error: "Internal server error during analysis request.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// GET: 분석 결과 조회
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    // 클라이언트가 jobId와 userToken을 쿼리 파라미터로 제공해야 함
    const jobId = url.searchParams.get("jobId");
    const userToken = url.searchParams.get("userToken"); // 결과 조회 API에 필요

    if (!jobId) {
      return NextResponse.json(
        { error: "jobId query parameter is required" },
        { status: 400 }
      );
    }
    if (!userToken) {
      return NextResponse.json(
        { error: "userToken query parameter is required" },
        { status: 400 }
      );
    }

    console.log(
      `[Audio Analysis API - GET] Result Request for jobId: ${jobId}, userToken: ${userToken}`
    );

    // 외부 감정 분석 결과 API 호출
    const resultResponse = await fetch(EmotionAPI.directResultEmo2, {
      // 결과 조회 API URL
      method: "GET", // 보통 결과 조회는 GET
      headers: {
        "EMO-Client-ID": EmotionAPI.clientId,
        "EMO-Secret-Key": EmotionAPI.secretKey,
        Referer: "http://49.247.42.95", // Pippo API가 요구하는 Referer
        "X-User-Token": userToken,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
      cache: "no-store",
    });

    console.log("[Audio Analysis API - GET] Result API Response Status:", {
      status: resultResponse.status,
      statusText: resultResponse.statusText,
    });

    if (!resultResponse.ok) {
      // 결과가 아직 준비되지 않았거나 (예: 404 Not Found 또는 특정 에러 코드),
      // 실제 에러인 경우를 구분해야 할 수 있습니다.
      // Pippo API 문서에 따르면 S0005 코드가 "분석 결과 없음"을 의미할 수 있습니다.
      const errorText = await resultResponse.text();
      console.warn(
        `[Audio Analysis API - GET] Result API error for jobId ${jobId}: ${resultResponse.status} - ${errorText}`
      );
      // 클라이언트가 폴링을 계속해야 하는지, 아니면 에러로 중단해야 하는지 알려줄 수 있는 상태 반환
      if (resultResponse.status === 404) {
        // 혹은 Pippo API의 "결과 없음" 코드 확인
        return NextResponse.json({
          success: true, // 요청 자체는 성공했으나
          status: "PROCESSING", // 아직 처리 중임을 명시
          message: "Analysis result is not_ready_yet. Please try again later.",
          jobId: jobId,
        });
      }
      // 그 외의 에러는 실패로 간주
      return NextResponse.json(
        {
          error: "Failed to fetch analysis result",
          details: errorText,
          jobId: jobId,
        },
        { status: resultResponse.status }
      );
    }

    const data = await resultResponse.json();
    console.log(
      `[Audio Analysis API - GET] Result API Success Response for jobId ${jobId}:`,
      JSON.stringify(data, null, 2)
    );

    // Pippo API 응답에서 실제 결과 데이터 경로 확인 필요 (예: data.data.content[0])
    if (
      data &&
      data.data &&
      data.data.content &&
      data.data.content.length > 0
    ) {
      const latestResult = data.data.content[0];
      // jobId와 요청된 jobId(또는 파일명)가 일치하는지 확인하는 로직 추가 가능
      // 예를 들어, latestResult.fileNameOrigin과 jobId에 포함된 파일명을 비교
      // 여기서는 최신 결과를 그냥 반환합니다.

      const filteredResponse = {
        ansDog: latestResult.ansDog || "",
        ansFilter: latestResult.ansFilter || "",
        fileNameOrigin: latestResult.fileNameOrigin || "",
        startTime: latestResult.startTime || "",
        endTime: latestResult.endTime || "",
      };

      return NextResponse.json({
        success: true,
        status: "COMPLETED",
        result: filteredResponse,
        jobId: jobId,
      });
    } else if (data && data.code === "S0005") {
      // Pippo API의 "분석 결과 없음" 코드
      console.log(
        `[Audio Analysis API - GET] Analysis pending (S0005) for jobId ${jobId}, userToken ${userToken}. Client should retry.`
      );
      return NextResponse.json({
        success: true,
        status: "PROCESSING",
        message:
          "Analysis is still in progress (S0005). Please try again later.",
        jobId: jobId,
      });
    } else {
      console.log(
        `[Audio Analysis API - GET] No content or unexpected data structure for jobId ${jobId}:`,
        data
      );
      return NextResponse.json({
        success: true, // 요청은 성공했으나
        status: "NO_CONTENT", // 유효한 컨텐츠가 없음
        message: "Analysis result not found or in an unexpected format.",
        jobId: jobId,
        rawData: data, // 디버깅을 위해 원본 데이터 포함 가능
      });
    }
  } catch (error) {
    console.error(
      `[Audio Analysis API - GET] Error for jobId (from query):`,
      error
    );
    return NextResponse.json(
      {
        error: "Internal server error while fetching result.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// CORS 설정을 위한 OPTIONS 핸들러
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204, // No Content
    headers: {
      "Access-Control-Allow-Origin": "*", // 실제 운영에서는 허용할 도메인으로 제한
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-User-Token", // 필요한 헤더 명시
    },
  });
}
