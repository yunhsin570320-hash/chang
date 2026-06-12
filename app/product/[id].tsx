import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TextInput,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Clock, Users, ShoppingBag, Trophy, EyeOff, X, Crown, RotateCcw, Trash2, Truck, Tag, ShoppingCart, Package, Check, Minus, Plus, Flag } from 'lucide-react-native';
import { supabase, Product, Bid, Profile, sendAuctionNotifications } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { CountdownTimer } from '../../components/CountdownTimer';

export default function ProductDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [product, setProduct] = useState<Product | null>(null);
  const [seller, setSeller] = useState<Profile | null>(null);
  const [bids, setBids] = useState<(Bid & { bidder?: Profile })[]>([]);
  const [bidCount, setBidCount] = useState(0);
  const [myBid, setMyBid] = useState<Bid | null>(null);
  const [bidAmount, setBidAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [bidError, setBidError] = useState<string | null>(null);
  const [resultModalVisible, setResultModalVisible] = useState(false);
  const [endAuctionModalVisible, setEndAuctionModalVisible] = useState(false);
  const [relistModalVisible, setRelistModalVisible] = useState(false);
  const [relistDuration, setRelistDuration] = useState('60');
  const [relistSubmitting, setRelistSubmitting] = useState(false);
  const [winnerProfile, setWinnerProfile] = useState<Profile | null>(null);
  const [purchaseQty, setPurchaseQty] = useState('1');
  const [directBuying, setDirectBuying] = useState(false);
  const [directBuyError, setDirectBuyError] = useState<string | null>(null);
  const [directBuySuccess, setDirectBuySuccess] = useState(false);
  const [reportModal, setReportModal] = useState(false);
  const [reportType, setReportType] = useState('');
  const [reportReason, setReportReason] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportSuccess, setReportSuccess] = useState(false);
  const [myReport, setMyReport] = useState<any>(null);
  const { user, currentRole } = useAuth();

  const fetchData = useCallback(async () => {
    if (!id) return;

    try {
      const { data: productData } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .single();

      setProduct(productData);

      if (productData?.seller_id) {
        const { data: sellerData } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', productData.seller_id)
          .single();
        setSeller(sellerData);
      }

      // Direct buy products: fetch winner profile, skip bids
      if (productData?.is_direct_buy) {
        if (productData?.winner_id && productData?.status === 'ended') {
          const { data: wp } = await supabase
            .from('profiles')
            .select('id, name')
            .eq('id', productData.winner_id)
            .maybeSingle();
          setWinnerProfile(wp as Profile | null);
        }
        return;
      }

      if (user) {
        const { data: myBidData } = await supabase
          .from('bids')
          .select('*')
          .eq('product_id', id)
          .eq('bidder_id', user.id)
          .maybeSingle();
        setMyBid(myBidData);

        const { data: myReportData } = await supabase
          .from('reports')
          .select('id')
          .eq('product_id', id)
          .eq('reporter_id', user.id)
          .maybeSingle();
        setMyReport(myReportData);
      }

      const { count } = await supabase
        .from('bids')
        .select('*', { count: 'exact', head: true })
        .eq('product_id', id);
      setBidCount(count || 0);

      if (productData?.status === 'ended') {
        const { data: allBids } = await supabase
          .from('bids')
          .select('*, bidder:profiles!bidder_id(name, id)')
          .eq('product_id', id)
          .order('amount', { ascending: false });
        setBids(allBids || []);
      }
    } catch (error) {
      console.error('Error fetching product:', error);
    } finally {
      setLoading(false);
    }
  }, [id, user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDirectBuy = async () => {
    if (!user || !product) return;
    const qty = parseInt(purchaseQty, 10);
    if (isNaN(qty) || qty <= 0) { setDirectBuyError('請輸入有效數量'); return; }
    const maxStock = product.stock_quantity ?? 1;
    if (qty > maxStock) { setDirectBuyError(`最多可購買 ${maxStock} 件`); return; }

    setDirectBuying(true);
    setDirectBuyError(null);
    try {
      const totalAmount = (product.direct_price || 0) * qty;
      const newStock = maxStock - qty;
      const isSoldOut = newStock <= 0;

      const { error } = await supabase
        .from('products')
        .update({
          stock_quantity: newStock,
          ...(isSoldOut ? { status: 'ended', winner_id: user.id, winning_amount: totalAmount } : {}),
        })
        .eq('id', id)
        .eq('status', 'active');

      if (error) throw error;

      await supabase.from('notifications').insert({
        user_id: user.id,
        product_id: id,
        type: 'won',
        title: '直購成功！',
        message: `您已成功購買「${product.name}」× ${qty} 件，金額 NT$ ${totalAmount.toLocaleString()}，請等候賣家聯繫交付事宜。`,
        is_read: false,
      });

      setDirectBuySuccess(true);
      fetchData();
    } catch (error) {
      setDirectBuyError('購買失敗，請重試');
      console.warn(error);
    } finally {
      setDirectBuying(false);
    }
  };

  const adjustDirectQty = (delta: number) => {
    const current = parseInt(purchaseQty, 10) || 1;
    const max = product?.stock_quantity ?? 1;
    setPurchaseQty(String(Math.max(1, Math.min(max, current + delta))));
  };

  const handlePlaceBid = async () => {
    if (!user) {
      return;
    }

    if (user.is_blocked) {
      return;
    }

    const amount = parseInt(bidAmount, 10);
    if (isNaN(amount) || amount <= 0) {
      return;
    }

    const reservePrice = product?.reserve_price ?? 0;
    if (reservePrice > 0 && amount < reservePrice) {
      setBidError(`出價金額必須不低於底價 NT$ ${reservePrice.toLocaleString()}`);
      return;
    }

    setBidError(null);
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from('bids')
        .insert({
          product_id: id,
          bidder_id: user.id,
          amount: amount,
        });

      if (error) {
        if (error.code === '23505') {
          return;
        }
        throw error;
      }

      fetchData();
    } catch (error) {
      console.error('Error placing bid:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEndAuction = async () => {
    if (!product || !user || user.id !== product.seller_id) return;
    setEndAuctionModalVisible(false);
    try {
      const { data: allBids } = await supabase
        .from('bids')
        .select('*, bidder:profiles!bidder_id(name, id)')
        .eq('product_id', id)
        .order('amount', { ascending: false });

      const winningBid = allBids?.[0];
      const winnerId = winningBid?.bidder_id ?? null;
      const winningAmount = winningBid?.amount ?? null;

      await supabase
        .from('products')
        .update({
          status: 'ended',
          winner_id: winnerId,
          winning_amount: winningAmount,
        })
        .eq('id', id);

      const bidderIds = (allBids || []).map(b => b.bidder_id).filter(Boolean);
      if (bidderIds.length > 0 && product) {
        await sendAuctionNotifications(id as string, product.name, winnerId || null, winningAmount || null, bidderIds);
      }

      fetchData();
      setResultModalVisible(true);
    } catch (error) {
      console.error('Error ending auction:', error);
    }
  };

  const handleRelist = async () => {
    if (!product || !user || user.id !== product.seller_id) return;
    const minutes = parseInt(relistDuration, 10);
    if (isNaN(minutes) || minutes <= 0) return;
    setRelistSubmitting(true);
    try {
      const endTime = new Date();
      endTime.setMinutes(endTime.getMinutes() + minutes);
      await supabase.from('products').update({
        status: 'active',
        end_time: endTime.toISOString(),
        winner_id: null,
        winning_amount: null,
      }).eq('id', id);
      setRelistModalVisible(false);
      fetchData();
    } catch (e) {
      console.error(e);
    } finally {
      setRelistSubmitting(false);
    }
  };

  const handleDelist = async () => {
    if (!product || !user || user.id !== product.seller_id) return;
    try {
      await supabase.from('products').delete().eq('id', id);
      router.back();
    } catch (e) {
      console.error(e);
    }
  };

  const handleReport = async () => {
    if (!user || !product || !reportType || !reportReason.trim()) return;
    setReportSubmitting(true);
    setReportError(null);
    try {
      const { error } = await supabase.from('reports').insert({
        reporter_id: user.id,
        reported_user_id: product.seller_id,
        product_id: product.id,
        type: reportType,
        reason: reportReason.trim(),
        status: 'pending',
      });
      if (error) throw error;
      setReportSuccess(true);
      setMyReport({ id: 'submitted' });
    } catch (e: any) {
      setReportError(e?.message || '提交失敗，請重試');
    } finally {
      setReportSubmitting(false);
    }
  };

  const REPORT_TYPES = [
    { key: 'fake_product', label: '不實商品' },
    { key: 'fraud', label: '詐欺' },
    { key: 'spam', label: '垃圾廣告' },
    { key: 'other', label: '其他' },
  ];

  const ReportModal = () => (
    <Modal visible={reportModal} transparent animationType="slide" onRequestClose={() => setReportModal(false)}>
      <View style={styles.modalOverlay}>
        <View style={styles.reportModalBox}>
          <View style={styles.reportModalHead}>
            <Text style={styles.reportModalTitle}>檢舉此商品</Text>
            <TouchableOpacity onPress={() => { setReportModal(false); setReportSuccess(false); setReportType(''); setReportReason(''); setReportError(null); }}>
              <X size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          {reportSuccess ? (
            <View style={styles.reportSuccessBox}>
              <Check size={40} color="#00D4AA" />
              <Text style={styles.reportSuccessTitle}>檢舉已提交</Text>
              <Text style={styles.reportSuccessText}>管理員將盡快審查，感謝您的回報</Text>
              <TouchableOpacity style={styles.reportDoneBtn} onPress={() => { setReportModal(false); setReportSuccess(false); }}>
                <Text style={styles.reportDoneBtnText}>確認</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.reportLabel}>檢舉原因</Text>
              <View style={styles.reportTypeRow}>
                {REPORT_TYPES.map(t => (
                  <TouchableOpacity
                    key={t.key}
                    style={[styles.reportTypePill, reportType === t.key && styles.reportTypePillActive]}
                    onPress={() => setReportType(t.key)}
                  >
                    <Text style={[styles.reportTypePillText, reportType === t.key && styles.reportTypePillTextActive]}>
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.reportLabel}>詳細說明 *</Text>
              <TextInput
                style={styles.reportReasonInput}
                value={reportReason}
                onChangeText={setReportReason}
                placeholder="請說明檢舉的具體原因"
                placeholderTextColor="#444"
                multiline
                numberOfLines={4}
              />

              {reportError && <Text style={styles.reportErrorText}>{reportError}</Text>}

              <TouchableOpacity
                style={[styles.reportSubmitBtn, (!reportType || !reportReason.trim() || reportSubmitting) && styles.reportSubmitBtnDisabled]}
                onPress={handleReport}
                disabled={!reportType || !reportReason.trim() || reportSubmitting}
              >
                {reportSubmitting ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Flag size={16} color="#fff" />
                    <Text style={styles.reportSubmitBtnText}>提交檢舉</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );

  const ResultModal = () => {
    const winner = bids[0];
    const isWinner = winner?.bidder_id === user?.id;

    return (
      <Modal
        visible={resultModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setResultModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.resultModalContent}>
            <TouchableOpacity
              style={styles.closeModal}
              onPress={() => setResultModalVisible(false)}
            >
              <X size={24} color="#fff" />
            </TouchableOpacity>

            <View style={styles.resultHeader}>
              <Crown size={48} color="#FFD700" />
              <Text style={styles.resultTitle}>開標結果公布</Text>
            </View>

            {winner ? (
              <View style={styles.winnerSection}>
                <Text style={styles.congratsText}>恭喜</Text>
                <Text style={styles.winnerNameText}>{winner.bidder?.name}</Text>
                <Text style={styles.congratsText}>成功得標！</Text>

                <View style={styles.amountCard}>
                  <Trophy size={24} color="#00D4AA" />
                  <Text style={styles.amountLabel}>得標金額</Text>
                  <Text style={styles.amountValue}>NT$ {(winner.amount || 0).toLocaleString()}</Text>
                </View>

                {isWinner && (
                  <View style={styles.myResultWinner}>
                    <Trophy size={32} color="#FFD700" />
                    <Text style={styles.myResultText}>您是得標者！</Text>
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.noBidsSection}>
                <Text style={styles.noBidText}>無人出價</Text>
                <Text style={styles.noBidSubText}>此商品流標</Text>
              </View>
            )}

            {bids.length > 0 && (
              <View style={styles.allBidsPreview}>
                <Text style={styles.allBidsTitle}>所有出價一覽</Text>
                {bids.map((bid, index) => (
                  <View key={bid.id} style={styles.bidGridItem}>
                    <View style={styles.bidGridRank}>
                      <Text style={styles.bidGridRankText}>#{index + 1}</Text>
                    </View>
                    <Text style={styles.bidGridName}>{bid.bidder?.name}</Text>
                    <Text style={styles.bidGridAmount}>NT$ {bid.amount.toLocaleString()}</Text>
                    {index === 0 && (
                      <View style={styles.winnerTag}>
                        <Trophy size={12} color="#FFD700" />
                        <Text style={styles.winnerTagText}>得標</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      </Modal>
    );
  };

  const EndAuctionModal = () => (
    <Modal
      visible={endAuctionModalVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setEndAuctionModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.endModalContent}>
          <TouchableOpacity
            style={styles.closeModal}
            onPress={() => setEndAuctionModalVisible(false)}
          >
            <X size={24} color="#fff" />
          </TouchableOpacity>

          <View style={styles.endModalHeader}>
            <Crown size={48} color="#FFD700" />
            <Text style={styles.endModalTitle}>確定要結束競標嗎？</Text>
          </View>

          <View style={styles.endModalBody}>
            <Text style={styles.endModalText}>結標後將公開所有出價紀錄，</Text>
            <Text style={styles.endModalText}>最高出價者將成為得標者。</Text>
            <Text style={styles.endModalWarning}>此操作無法撤銷！</Text>
          </View>

          <View style={styles.endModalButtons}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setEndAuctionModalVisible(false)}
            >
              <Text style={styles.cancelButtonText}>取消</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.confirmButton}
              onPress={handleEndAuction}
            >
              <Crown size={18} color="#fff" />
              <Text style={styles.confirmButtonText}>確認結標</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#00D4AA" />
      </View>
    );
  }

  if (!product) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>找不到此商品</Text>
      </View>
    );
  }

  const winner = product.status === 'ended' && !product.is_direct_buy ? bids[0] : null;
  const isWinner = winner?.bidder_id === user?.id;
  const isSeller = user && product.seller_id === user.id;
  const isEnded = product.status === 'ended';
  const hasSold = isEnded && product.winning_amount && product.winning_amount > 0;
  const isUnsold = isEnded && (!product.winning_amount || product.winning_amount === 0) && !product.is_direct_buy;
  const isDirectBuy = product.is_direct_buy === true;
  const directStock = product.stock_quantity ?? 0;
  const directPurchasedQty = isDirectBuy && product.direct_price
    ? Math.round((product.winning_amount || 0) / product.direct_price)
    : 0;

  return (
    <>
      <ReportModal />
      <ResultModal />
      <EndAuctionModal />

      <ScrollView style={styles.container} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={styles.imageContainer}>
          <Image
            source={{
              uri: product.image_url || 'https://images.pexels.com/photos/90946/pexels-photo-90946.jpeg?w=600'
            }}
            style={styles.image}
            resizeMode="cover"
          />
          <View style={[styles.statusBadge, {
            backgroundColor: isDirectBuy
              ? (isEnded ? 'rgba(255,107,107,0.8)' : 'rgba(255,215,0,0.85)')
              : (isEnded ? 'rgba(255,107,107,0.8)' : 'rgba(0,0,0,0.8)')
          }]}>
            <Text style={[styles.statusText, {
              color: isDirectBuy ? (isEnded ? '#fff' : '#000') : (isEnded ? '#fff' : '#00D4AA')
            }]}>
              {isDirectBuy ? (isEnded ? '已售完' : '直購') : (isEnded ? '已結標' : '競標中')}
            </Text>
          </View>
        </View>

        <View style={styles.content}>
          <Text style={styles.title}>{product.name}</Text>

          <View style={styles.sellerRow}>
            <ShoppingBag size={16} color="#888" />
            <Text style={styles.sellerName}>{seller?.name || '匿名賣家'}</Text>
            {user && !isSeller && (
              <TouchableOpacity
                style={[styles.reportBtn, myReport && styles.reportBtnDone]}
                onPress={() => { if (!myReport) { setReportModal(true); } }}
                disabled={!!myReport}
              >
                <Flag size={12} color={myReport ? '#555' : '#FF6B6B'} />
                <Text style={[styles.reportBtnText, myReport && { color: '#555' }]}>
                  {myReport ? '已檢舉' : '檢舉'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.statsRow}>
            {isDirectBuy ? (
              <>
                <View style={[styles.statCard, { borderColor: 'rgba(255,215,0,0.2)' }]}>
                  <Tag size={18} color="#FFD700" />
                  <Text style={styles.statLabel}>直購價格</Text>
                  <Text style={[styles.statValue, { color: '#FFD700', fontSize: 20 }]}>
                    NT$ {(product.direct_price || 0).toLocaleString()}
                  </Text>
                </View>
                <View style={[styles.statCard, { borderColor: 'rgba(255,215,0,0.2)' }]}>
                  <Package size={18} color={directStock > 0 ? '#00D4AA' : '#FF6B6B'} />
                  <Text style={styles.statLabel}>{isEnded ? '購買數量' : '剩餘庫存'}</Text>
                  <Text style={[styles.statValue, { color: directStock > 0 ? '#fff' : '#FF6B6B' }]}>
                    {isEnded ? `${directPurchasedQty} 件` : `${directStock} 件`}
                  </Text>
                </View>
              </>
            ) : (
              <>
                <View style={styles.statCard}>
                  <Clock size={18} color="#00D4AA" />
                  <Text style={styles.statLabel}>剩餘時間</Text>
                  <CountdownTimer endTime={product.end_time || ''} size="large" isEnded={product.status === 'ended'} />
                </View>
                <View style={styles.statCard}>
                  <Users size={18} color="#888" />
                  <Text style={styles.statLabel}>出價人數</Text>
                  <Text style={styles.statValue}>{product.status === 'ended' ? bids.length : bidCount}</Text>
                </View>
              </>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>商品描述</Text>
            <Text style={styles.description}>{product.description || '暫無描述'}</Text>
          </View>

          {isDirectBuy && isEnded && (
            <View style={styles.section}>
              <View style={styles.directSoldCard}>
                <Check size={28} color="#00D4AA" />
                <Text style={styles.directSoldTitle}>直購完成</Text>
                <View style={styles.directSoldRow}>
                  <Text style={styles.directSoldLabel}>購買者</Text>
                  <Text style={styles.directSoldValue}>{winnerProfile?.name || '—'}</Text>
                  {winnerProfile?.id === user?.id && (
                    <View style={styles.youTag}><Text style={styles.youTagText}>您</Text></View>
                  )}
                </View>
                <View style={styles.directSoldRow}>
                  <Text style={styles.directSoldLabel}>購買數量</Text>
                  <Text style={styles.directSoldValue}>{directPurchasedQty} 件</Text>
                </View>
                <View style={styles.directSoldRow}>
                  <Text style={styles.directSoldLabel}>總金額</Text>
                  <Text style={[styles.directSoldValue, { color: '#FFD700' }]}>
                    NT$ {(product.winning_amount || 0).toLocaleString()}
                  </Text>
                </View>
              </View>
            </View>
          )}

          {isDirectBuy && !isEnded && isSeller && (
            <View style={styles.section}>
              <View style={styles.sellerNotice}>
                <Tag size={20} color="#FFD700" />
                <Text style={styles.sellerNoticeText}>此為您上架的直購商品，剩餘庫存 {directStock} 件</Text>
              </View>
            </View>
          )}

          {isDirectBuy && !isEnded && user && currentRole === 'buyer' && !isSeller && (
            <View style={styles.section}>
              {directBuySuccess ? (
                <View style={styles.directBuySuccessCard}>
                  <Check size={32} color="#00D4AA" />
                  <Text style={styles.directBuySuccessTitle}>購買成功！</Text>
                  <Text style={styles.directBuySuccessText}>賣家將盡快與您聯繫安排交付</Text>
                </View>
              ) : (
                <View style={styles.directBuyForm}>
                  <View style={styles.directBuyHeader}>
                    <ShoppingCart size={20} color="#FFD700" />
                    <Text style={styles.directBuyTitle}>直接購買</Text>
                  </View>
                  <View style={styles.directBuyPriceRow}>
                    <Text style={styles.directBuyPriceLabel}>單價</Text>
                    <Text style={styles.directBuyPrice}>NT$ {(product.direct_price || 0).toLocaleString()}</Text>
                  </View>
                  <View style={styles.directBuyQtyRow}>
                    <Text style={styles.directBuyQtyLabel}>數量</Text>
                    <View style={styles.qtyControls}>
                      <TouchableOpacity style={styles.qtyBtn} onPress={() => adjustDirectQty(-1)}>
                        <Minus size={16} color="#FFD700" />
                      </TouchableOpacity>
                      <TextInput
                        style={styles.qtyInput}
                        value={purchaseQty}
                        onChangeText={(v) => {
                          const n = parseInt(v, 10);
                          if (v === '') { setPurchaseQty(''); return; }
                          if (!isNaN(n)) setPurchaseQty(String(Math.max(1, Math.min(directStock, n))));
                        }}
                        keyboardType="numeric"
                      />
                      <TouchableOpacity style={styles.qtyBtn} onPress={() => adjustDirectQty(1)}>
                        <Plus size={16} color="#FFD700" />
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.directBuyStock}>剩 {directStock} 件</Text>
                  </View>
                  <View style={styles.directBuyTotalRow}>
                    <Text style={styles.directBuyTotalLabel}>合計</Text>
                    <Text style={styles.directBuyTotal}>
                      NT$ {((product.direct_price || 0) * (parseInt(purchaseQty, 10) || 0)).toLocaleString()}
                    </Text>
                  </View>
                  {directBuyError && <Text style={styles.directBuyError}>{directBuyError}</Text>}
                  <TouchableOpacity
                    style={[styles.directBuyBtn, directBuying && { opacity: 0.6 }]}
                    onPress={handleDirectBuy}
                    disabled={directBuying}
                  >
                    {directBuying ? <ActivityIndicator color="#000" /> : (
                      <>
                        <ShoppingCart size={18} color="#000" />
                        <Text style={styles.directBuyBtnText}>確認購買</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {product.status === 'ended' && !isDirectBuy && (
            <View style={styles.section}>
              <TouchableOpacity
                style={styles.resultCard}
                onPress={() => setResultModalVisible(true)}
              >
                <View style={styles.resultCardHeader}>
                  <Crown size={28} color="#FFD700" />
                  <Text style={styles.resultCardTitle}>開標結果</Text>
                  <Text style={styles.tapToView}>點擊查看完整結果</Text>
                </View>

                {winner ? (
                  <View style={styles.resultCardBody}>
                    <View style={styles.winnerRow}>
                      <Text style={styles.winnerLabel}>得標者</Text>
                      <Text style={styles.winnerName}>{winner.bidder?.name}</Text>
                      {isWinner && (
                        <View style={styles.youTag}>
                          <Text style={styles.youTagText}>您</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.winnerRow}>
                      <Text style={styles.winnerLabel}>得標金額</Text>
                      <Text style={styles.winnerAmount}>NT$ {winner.amount?.toLocaleString()}</Text>
                    </View>
                    <Text style={styles.totalBidders}>共 {bidCount} 人參與競標</Text>
                  </View>
                ) : (
                  <View style={styles.noBidsCard}>
                    <Text style={styles.noBidsText}>無人出價，商品流標</Text>
                  </View>
                )}
              </TouchableOpacity>

              {bids.length > 0 && (
                <View style={styles.allBidsSection}>
                  <Text style={styles.allBidsTitle透明}>所有出價紀錄（透明公開）</Text>
                  {bids.map((bid, index) => (
                    <View
                      key={bid.id}
                      style={[styles.bidItem, index === 0 && styles.winnerBidItem]}
                    >
                      <View style={styles.bidRank}>
                        <Text style={styles.bidRankText}>#{index + 1}</Text>
                      </View>
                      <Text style={styles.bidderName}>
                        {bid.bidder?.name || '匿名'}
                        {bid.bidder_id === user?.id && (
                          <Text style={styles.meTag}> (您)</Text>
                        )}
                      </Text>
                      <Text style={styles.bidAmountText}>NT$ {bid.amount.toLocaleString()}</Text>
                      {index === 0 && (
                        <Trophy size={16} color="#FFD700" />
                      )}
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {product.status === 'active' && !isDirectBuy && isSeller && (
            <View style={styles.section}>
              <View style={styles.sellerNotice}>
                <ShoppingBag size={20} color="#FFD700" />
                <Text style={styles.sellerNoticeText}>此為您上架的商品，賣家不得對自己的商品出價</Text>
              </View>
            </View>
          )}

          {product.status === 'active' && !isDirectBuy && user && currentRole === 'buyer' && !isSeller && !myBid && (
            <View style={styles.section}>
              <View style={styles.bidForm}>
                <View style={styles.blindNotice}>
                  <EyeOff size={20} color="#FFD700" />
                  <Text style={styles.blindText}>暗標競標 - 您的出價將保密直到開標</Text>
                </View>
                {(product.reserve_price ?? 0) > 0 && (
                  <View style={styles.reserveNotice}>
                    <Text style={styles.reserveText}>底價：NT$ {(product.reserve_price ?? 0).toLocaleString()}（出價需達底價）</Text>
                  </View>
                )}
                <Text style={styles.bidLabel}>輸入您的出價金額</Text>
                <View style={styles.inputRow}>
                  <Text style={styles.currencyPrefix}>NT$</Text>
                  <TextInput
                    style={styles.input}
                    value={bidAmount}
                    onChangeText={(v) => { setBidAmount(v); setBidError(null); }}
                    placeholder={(product.reserve_price ?? 0) > 0 ? `最低 ${(product.reserve_price ?? 0).toLocaleString()}` : '輸入金額'}
                    placeholderTextColor="#444"
                    keyboardType="numeric"
                  />
                </View>
                {bidError && <Text style={styles.bidError}>{bidError}</Text>}
                <TouchableOpacity
                  style={[styles.bidButton, submitting && styles.disabled]}
                  onPress={handlePlaceBid}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <Text style={styles.bidButtonText}>確認出價</Text>
                  )}
                </TouchableOpacity>
                <Text style={styles.bidWarning}>注意: 每件商品只能出價一次，請謹慎決定！</Text>
              </View>
            </View>
          )}

          {product.status === 'active' && !isDirectBuy && !isSeller && myBid && (
            <View style={styles.section}>
              <View style={styles.alreadyBidCard}>
                <Trophy size={28} color="#00D4AA" />
                <Text style={styles.alreadyBidTitle}>已成功出價</Text>
                <Text style={styles.alreadyBidText}>您已成功出價，結果將在開標時公布</Text>
                <View style={styles.myBidInfo}>
                  <Text style={styles.myBidLabel}>您的出價</Text>
                  <Text style={styles.myBidAmount}>NT$ {myBid.amount.toLocaleString()}</Text>
                </View>
              </View>
            </View>
          )}

          {product.status === 'active' && !isDirectBuy && isSeller && (
            <View style={styles.section}>
              <TouchableOpacity
                style={styles.endAuctionButton}
                onPress={() => setEndAuctionModalVisible(true)}
              >
                <Crown size={20} color="#FFD700" />
                <Text style={styles.endAuctionText}>立即結標並公開結果</Text>
              </TouchableOpacity>
            </View>
          )}

          {isUnsold && isSeller && (
            <View style={styles.section}>
              <View style={styles.unsoldActions}>
                <Text style={styles.unsoldTitle}>此商品無人得標</Text>
                <View style={styles.unsoldButtons}>
                  <TouchableOpacity style={styles.relistButton} onPress={() => setRelistModalVisible(true)}>
                    <RotateCcw size={18} color="#00D4AA" />
                    <Text style={styles.relistButtonText}>重新上架</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.delistButton} onPress={handleDelist}>
                    <Trash2 size={18} color="#FF6B6B" />
                    <Text style={styles.delistButtonText}>下架商品</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}

          {hasSold && isSeller && (
            <View style={styles.section}>
              <TouchableOpacity
                style={styles.deliveryButton}
                onPress={() => router.push({ pathname: '/delivery/[id]' as any, params: { id: product.id } })}
              >
                <Truck size={20} color="#000" />
                <Text style={styles.deliveryButtonText}>進行交付管理</Text>
              </TouchableOpacity>
            </View>
          )}

          <Modal visible={relistModalVisible} transparent animationType="fade" onRequestClose={() => setRelistModalVisible(false)}>
            <View style={styles.modalOverlay}>
              <View style={styles.relistModal}>
                <TouchableOpacity style={styles.closeModal} onPress={() => setRelistModalVisible(false)}>
                  <X size={24} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.relistModalTitle}>重新上架</Text>
                <Text style={styles.relistModalLabel}>設定新的競標時間（分鐘）</Text>
                <TextInput
                  style={styles.relistInput}
                  value={relistDuration}
                  onChangeText={setRelistDuration}
                  keyboardType="numeric"
                  placeholder="例如: 60"
                  placeholderTextColor="#444"
                />
                <Text style={styles.relistHint}>輸入 60 = 1 小時後結標</Text>
                <TouchableOpacity
                  style={[styles.relistConfirmBtn, relistSubmitting && { opacity: 0.6 }]}
                  onPress={handleRelist}
                  disabled={relistSubmitting}
                >
                  {relistSubmitting ? <ActivityIndicator color="#000" /> : (
                    <Text style={styles.relistConfirmText}>確認重新上架</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D1A' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0D0D1A' },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0D0D1A' },
  errorText: { color: '#FF6B6B', fontSize: 16 },
  imageContainer: { position: 'relative', overflow: 'hidden', maxHeight: 320 },
  image: { width: '100%', height: 280, objectFit: 'cover' } as any,
  statusBadge: {
    position: 'absolute',
    top: 16,
    right: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderRadius: 8,
  },
  statusText: { fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
  content: { padding: 20 },
  title: { fontSize: 26, fontWeight: '800', color: '#fff', marginBottom: 12 },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  sellerName: { fontSize: 14, color: '#888' },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  statCard: {
    flex: 1,
    backgroundColor: '#1A1A2E',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 170, 0.15)',
  },
  statLabel: { fontSize: 12, color: '#888', marginTop: 8, marginBottom: 4 },
  statValue: { fontSize: 24, fontWeight: '700', color: '#fff' },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 12 },
  description: { fontSize: 15, color: '#ccc', lineHeight: 24 },
  bidForm: {
    backgroundColor: '#1A1A2E',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 170, 0.2)',
  },
  blindNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 215, 0, 0.2)',
  },
  blindText: { fontSize: 13, color: '#FFD700', fontWeight: '600' },
  reserveNotice: {
    backgroundColor: 'rgba(255,107,107,0.1)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.3)',
  },
  reserveText: { color: '#FF6B6B', fontSize: 13, fontWeight: '600' },
  bidError: { color: '#FF6B6B', fontSize: 13, marginBottom: 8, textAlign: 'center' },
  bidLabel: { fontSize: 14, color: '#888', marginBottom: 8 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#00D4AA',
    borderRadius: 8,
    marginBottom: 16,
    backgroundColor: '#0D0D1A',
  },
  currencyPrefix: { color: '#00D4AA', fontSize: 18, fontWeight: '600', paddingLeft: 16 },
  input: { flex: 1, padding: 16, fontSize: 20, color: '#fff', fontWeight: '600' },
  bidButton: { backgroundColor: '#00D4AA', padding: 16, borderRadius: 10, alignItems: 'center' },
  disabled: { opacity: 0.6 },
  bidButtonText: { color: '#000', fontSize: 16, fontWeight: '700' },
  bidWarning: { fontSize: 12, color: '#FF6B6B', textAlign: 'center', marginTop: 12 },
  resultCard: {
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.3)',
    marginBottom: 16,
  },
  resultCardHeader: { alignItems: 'center', marginBottom: 16 },
  resultCardTitle: { fontSize: 20, fontWeight: '800', color: '#FFD700', marginTop: 8 },
  tapToView: { fontSize: 12, color: '#888', marginTop: 4 },
  resultCardBody: { gap: 12 },
  winnerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  winnerLabel: { fontSize: 14, color: '#888', width: 80 },
  winnerName: { fontSize: 18, fontWeight: '700', color: '#fff', flex: 1 },
  youTag: { backgroundColor: '#00D4AA', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  youTagText: { color: '#000', fontSize: 12, fontWeight: '700' },
  winnerAmount: { fontSize: 20, fontWeight: '800', color: '#FFD700' },
  totalBidders: { fontSize: 13, color: '#888', textAlign: 'center', marginTop: 8 },
  noBidsCard: { alignItems: 'center', padding: 20 },
  noBidsText: { fontSize: 16, color: '#888', textAlign: 'center' },
  allBidsSection: {
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.2)',
  },
  allBidsTitle透明: { fontSize: 16, fontWeight: '700', color: '#FFD700', marginBottom: 12 },
  bidItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    gap: 12,
  },
  winnerBidItem: {
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    marginHorizontal: -12,
    paddingHorizontal: 12,
    marginVertical: -4,
    paddingVertical: 16,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#FFD700',
  },
  bidRank: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bidRankText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  bidderName: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '500' },
  meTag: { color: '#00D4AA', fontWeight: '600' },
  bidAmountText: { fontSize: 16, fontWeight: '700', color: '#00D4AA' },
  alreadyBidCard: {
    backgroundColor: 'rgba(0, 212, 170, 0.1)',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 170, 0.3)',
  },
  alreadyBidTitle: { fontSize: 20, fontWeight: '800', color: '#00D4AA', marginTop: 12, marginBottom: 8 },
  alreadyBidText: { fontSize: 14, color: '#ccc', textAlign: 'center', marginBottom: 16 },
  myBidInfo: { alignItems: 'center' },
  myBidLabel: { fontSize: 12, color: '#888', marginBottom: 4 },
  myBidAmount: { fontSize: 28, fontWeight: '900', color: '#fff' },
  endAuctionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 215, 0, 0.15)',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FFD700',
  },
  endAuctionText: { color: '#FFD700', fontSize: 15, fontWeight: '600' },
  sellerNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,215,0,0.1)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.3)',
  },
  sellerNoticeText: { color: '#FFD700', fontSize: 13, flex: 1, lineHeight: 20 },
  unsoldActions: {
    backgroundColor: 'rgba(255,107,107,0.08)',
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.3)',
    gap: 16,
  },
  unsoldTitle: { color: '#FF6B6B', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  unsoldButtons: { flexDirection: 'row', gap: 12 },
  relistButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,212,170,0.15)',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#00D4AA',
  },
  relistButtonText: { color: '#00D4AA', fontSize: 14, fontWeight: '600' },
  delistButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,107,107,0.15)',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FF6B6B',
  },
  delistButtonText: { color: '#FF6B6B', fontSize: 14, fontWeight: '600' },
  deliveryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#00D4AA',
    padding: 16,
    borderRadius: 12,
  },
  deliveryButtonText: { color: '#000', fontSize: 16, fontWeight: '700' },
  relistModal: {
    backgroundColor: '#1A1A2E',
    borderRadius: 20,
    padding: 24,
    width: '85%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: 'rgba(0,212,170,0.3)',
  },
  relistModalTitle: { color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 20, marginTop: 8 },
  relistModalLabel: { color: '#888', fontSize: 13, marginBottom: 8 },
  relistInput: {
    backgroundColor: '#0D0D1A',
    borderRadius: 8,
    padding: 14,
    color: '#fff',
    fontSize: 18,
    borderWidth: 1,
    borderColor: 'rgba(0,212,170,0.4)',
    marginBottom: 8,
  },
  relistHint: { color: '#666', fontSize: 12, marginBottom: 20 },
  relistConfirmBtn: {
    backgroundColor: '#00D4AA',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  relistConfirmText: { color: '#000', fontSize: 15, fontWeight: '700' },
  closeModal: { position: 'absolute', top: 16, right: 16, zIndex: 1 },
  directSoldCard: {
    backgroundColor: 'rgba(0,212,170,0.08)', borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: 'rgba(0,212,170,0.25)', alignItems: 'center', gap: 12,
  },
  directSoldTitle: { fontSize: 20, fontWeight: '800', color: '#00D4AA', marginBottom: 4 },
  directSoldRow: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%' },
  directSoldLabel: { fontSize: 14, color: '#888', width: 70 },
  directSoldValue: { fontSize: 16, fontWeight: '700', color: '#fff', flex: 1 },
  directBuyForm: {
    backgroundColor: '#1A1A2E', borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.25)', gap: 12,
  },
  directBuyHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  directBuyTitle: { fontSize: 18, fontWeight: '700', color: '#FFD700' },
  directBuyPriceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  directBuyPriceLabel: { color: '#888', fontSize: 14 },
  directBuyPrice: { color: '#FFD700', fontSize: 20, fontWeight: '800' },
  directBuyQtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  directBuyQtyLabel: { color: '#888', fontSize: 14, width: 36 },
  qtyControls: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)', borderRadius: 8, overflow: 'hidden',
  },
  qtyBtn: {
    width: 36, height: 40, justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(255,215,0,0.1)',
  },
  qtyInput: {
    width: 52, height: 40, textAlign: 'center',
    color: '#fff', fontSize: 16, fontWeight: '700',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  directBuyStock: { color: '#555', fontSize: 12, marginLeft: 4 },
  directBuyTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: 'rgba(255,215,0,0.08)', borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.2)',
  },
  directBuyTotalLabel: { color: '#888', fontSize: 14 },
  directBuyTotal: { color: '#FFD700', fontSize: 22, fontWeight: '900' },
  directBuyError: { color: '#FF6B6B', fontSize: 13, textAlign: 'center' },
  directBuyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#FFD700', padding: 16, borderRadius: 12,
  },
  directBuyBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
  directBuySuccessCard: {
    backgroundColor: 'rgba(0,212,170,0.1)', borderRadius: 16, padding: 24,
    alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: 'rgba(0,212,170,0.3)',
  },
  directBuySuccessTitle: { fontSize: 20, fontWeight: '800', color: '#00D4AA' },
  directBuySuccessText: { fontSize: 14, color: '#888', textAlign: 'center' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultModalContent: {
    backgroundColor: '#1A1A2E',
    borderRadius: 24,
    padding: 24,
    width: '90%',
    maxWidth: 400,
    maxHeight: '85%',
    borderWidth: 2,
    borderColor: '#FFD700',
  },
  resultHeader: { alignItems: 'center', marginBottom: 24, marginTop: 20 },
  resultTitle: { fontSize: 24, fontWeight: '800', color: '#FFD700', marginTop: 12 },
  winnerSection: { alignItems: 'center', marginBottom: 20 },
  congratsText: { fontSize: 18, color: '#ccc' },
  winnerNameText: { fontSize: 28, fontWeight: '900', color: '#FFD700', marginVertical: 8 },
  amountCard: {
    backgroundColor: 'rgba(0, 212, 170, 0.15)',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginTop: 16,
    width: '100%',
  },
  amountLabel: { fontSize: 14, color: '#888', marginTop: 8 },
  amountValue: { fontSize: 32, fontWeight: '900', color: '#00D4AA' },
  myResultWinner: {
    alignItems: 'center',
    marginTop: 20,
    padding: 16,
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    borderRadius: 12,
    width: '100%'
  },
  myResultText: { color: '#FFD700', fontSize: 16, fontWeight: '700', marginTop: 8 },
  noBidsSection: { alignItems: 'center', padding: 30 },
  noBidText: { fontSize: 18, color: '#888', fontWeight: '600' },
  noBidSubText: { fontSize: 14, color: '#666', marginTop: 8 },
  allBidsPreview: {
    maxHeight: 200,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  allBidsTitle: { fontSize: 14, color: '#888', marginBottom: 12 },
  bidGridItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 8,
  },
  bidGridRank: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bidGridRankText: { color: '#888', fontSize: 12, fontWeight: '600' },
  bidGridName: { flex: 1, color: '#fff', fontSize: 14 },
  bidGridAmount: { color: '#00D4AA', fontSize: 14, fontWeight: '600' },
  winnerTag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 8 },
  winnerTagText: { color: '#FFD700', fontSize: 12, fontWeight: '700' },
  endModalContent: {
    backgroundColor: '#1A1A2E',
    borderRadius: 24,
    padding: 24,
    width: '90%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.3)',
  },
  endModalHeader: { alignItems: 'center', marginBottom: 16 },
  endModalTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginTop: 12 },
  endModalBody: { alignItems: 'center', marginBottom: 24 },
  endModalText: { fontSize: 14, color: '#ccc', textAlign: 'center' },
  endModalWarning: { fontSize: 14, color: '#FF6B6B', fontWeight: '700', marginTop: 12 },
  endModalButtons: { flexDirection: 'row', gap: 12 },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
  },
  cancelButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  confirmButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#FF6B6B',
  },
  confirmButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  reportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,107,107,0.4)',
    backgroundColor: 'rgba(255,107,107,0.08)', marginLeft: 'auto',
  },
  reportBtnDone: {
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  reportBtnText: { color: '#FF6B6B', fontSize: 11, fontWeight: '600' },
  reportModalBox: {
    backgroundColor: '#1A1A2E', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, maxHeight: '85%', width: '100%',
    position: 'absolute', bottom: 0, left: 0, right: 0,
  },
  reportModalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  reportModalTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  reportLabel: { color: '#888', fontSize: 13, fontWeight: '600', marginBottom: 10 },
  reportTypeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  reportTypePill: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)',
  },
  reportTypePillActive: { borderColor: '#FF6B6B', backgroundColor: 'rgba(255,107,107,0.15)' },
  reportTypePillText: { color: '#888', fontSize: 13, fontWeight: '600' },
  reportTypePillTextActive: { color: '#FF6B6B' },
  reportReasonInput: {
    backgroundColor: '#0D0D1A', borderRadius: 10, padding: 14,
    color: '#fff', fontSize: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    textAlignVertical: 'top', minHeight: 100, marginBottom: 16,
  },
  reportErrorText: { color: '#FF6B6B', fontSize: 13, marginBottom: 12, textAlign: 'center' },
  reportSubmitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#FF6B6B', borderRadius: 12, padding: 16, marginBottom: 8,
  },
  reportSubmitBtnDisabled: { opacity: 0.4 },
  reportSubmitBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  reportSuccessBox: { alignItems: 'center', paddingVertical: 24, gap: 12 },
  reportSuccessTitle: { color: '#00D4AA', fontSize: 20, fontWeight: '800' },
  reportSuccessText: { color: '#888', fontSize: 14, textAlign: 'center' },
  reportDoneBtn: { marginTop: 8, backgroundColor: '#00D4AA', borderRadius: 10, paddingHorizontal: 32, paddingVertical: 12 },
  reportDoneBtnText: { color: '#000', fontSize: 15, fontWeight: '700' },
});
